import { Builder, By, until, Key } from 'selenium-webdriver';
import chrome, { ServiceBuilder } from 'selenium-webdriver/chrome';
import pool from '@/app/lib/db';
import axios from 'axios';

const numpadMap: { [key: string]: string } = {
    '0': Key.NUMPAD0,
    '1': Key.NUMPAD1,
    '2': Key.NUMPAD2,
    '3': Key.NUMPAD3,
    '4': Key.NUMPAD4,
    '5': Key.NUMPAD5,
    '6': Key.NUMPAD6,
    '7': Key.NUMPAD7,
    '8': Key.NUMPAD8,
    '9': Key.NUMPAD9,
};

export async function generateInvoices() {
    const client = await pool.connect();

    try {
        const { rows: orderHeaders } = await client.query(
            'SELECT * FROM order_header WHERE has_invoice = false AND document_type = $1',
            ['boleta']
        );

        if (orderHeaders.length === 0) {
            console.log('No hay órdenes pendientes de boleta.');
            return;
        }

        const options = new chrome.Options();
        options.addArguments('--start-maximized');
        options.setUserPreferences({ 'profile.default_content_setting_values.notifications': 2 });

        const service = new ServiceBuilder('C:\\webdrivers\\chromedriver.exe');

        const driver = await new Builder()
            .forBrowser('chrome')
            .setChromeService(service)
            .setChromeOptions(options)
            .build();

        await driver.get('https://eboleta.sii.cl/emitir/');
        await driver.sleep(2000);

        const rutInput = await driver.wait(until.elementLocated(By.css('input[name="rut"]')), 10000);
        await rutInput.sendKeys('26297437-5');

        const claveInput = await driver.findElement(By.css('input#inputPass'));
        await claveInput.sendKeys('krys55555');

        const ingresarBtn = await driver.findElement(By.css('button#bt_ingresar'));
        await ingresarBtn.click();
        await driver.sleep(4000);

        await driver.wait(
            until.elementLocated(By.xpath('//button[contains(@class,"success") and contains(., "Emitir")]')),
            15000
        );

        for (const header of orderHeaders) {
            const { rows: details } = await client.query(
                'SELECT * FROM order_detail WHERE id_order_header = $1',
                [header.id]
            );

            console.log(`Generando boleta para orden ${header.order_id}`);

            await driver.sleep(500);
            for (let i = 0; i < 10; i++) {
                await driver.actions({ async: true }).sendKeys(Key.BACK_SPACE).perform();
                await driver.sleep(100);
            }

            const montoTotal = header.total_amount.toFixed(0) + header.shipping_ammount.toFixed(0);
            const montoTeclas = montoTotal.split('').map((d: string) => numpadMap[d]);
            await driver.actions({ async: true }).sendKeys(...montoTeclas).perform();

            await driver.wait(async () => {
                const span = await driver.findElement(By.xpath('//span[contains(text(), "$")]'));
                const text = await span.getText();
                return text.trim() !== '$ 0';
            }, 10000);

            const emitirBtn = await driver.findElement(By.xpath('//button[contains(@class,"success") and contains(., "Emitir")]'));
            await emitirBtn.click();

            await driver.sleep(2000);
            await driver.wait(until.elementLocated(By.css('.v-input--switch__thumb')), 10000);

            const inputSwitch = await driver.wait(
                until.elementLocated(By.css('input#input-135[type="checkbox"]')),
                10000
            );
            await driver.executeScript(`
                const input = arguments[0];
                if (!input.checked) {
                    input.click();
                }
            `, inputSwitch);

            await driver.wait(until.elementLocated(By.css('#input-139')), 10000);
            await driver.sleep(1000);

            const descripcion = details.map(d => `${d.product_quantity} ${d.product_title}`).join(' - ').slice(0, 80);
            const detalleInput = await driver.findElement(By.css('#input-139'));
            await detalleInput.sendKeys(descripcion);

            await driver.sleep(2000);

            await driver.actions({ async: true }).sendKeys(Key.TAB).perform();
            await driver.sleep(300);
            await driver.actions({ async: true }).sendKeys(Key.ENTER).perform();

            await driver.sleep(2000);
            await driver.wait(
                until.elementLocated(By.xpath('//div[contains(text(), "Boleta generada")]')),
                15000
            );

            console.log(`✅ Boleta emitida para orden ${header.order_id}`);

            const downloadBtn = await driver.findElement(By.xpath('//a[contains(., "Descargar")]'));
            const downloadUrl = await downloadBtn.getAttribute('href');

            if (!downloadUrl) {
                console.error(`❌ No se encontró enlace de descarga para orden ${header.order_id}`);
                continue;
            }

            const response = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
            const pdfBuffer = Buffer.from(response.data);

            await client.query(
                'UPDATE order_header SET invoice_pdf = $1, has_invoice = true WHERE id = $2',
                [pdfBuffer, header.id]
            );

            console.log(`📂 Boleta guardada en base de datos para orden ${header.order_id}`);

            try {
                const closeBtn = await driver.wait(
                    until.elementLocated(By.xpath('//i[contains(text(), "close")]')),
                    10000
                );
                await closeBtn.click();
                await driver.sleep(2000);
            } catch (e) {
                console.error('❌ No se pudo cerrar la boleta con la X:', e);
            }
        }

        // await driver.quit();

    } catch (error) {
        console.error('Error durante el proceso de boletas:', error);
    } finally {
        client.release();
    }
}
