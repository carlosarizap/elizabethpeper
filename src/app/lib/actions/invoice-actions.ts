import { Builder, By, until, Key } from 'selenium-webdriver';
import chrome, { ServiceBuilder } from 'selenium-webdriver/chrome';
import pool from '@/app/lib/db';

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
        const { rows: orders } = await client.query(
            'SELECT * FROM orders WHERE has_invoice = false'
        );

        if (orders.length === 0) {
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

        // 1. Ir al login
        await driver.get('https://eboleta.sii.cl/emitir/');
        await driver.sleep(2000);

        // 2. Login automático
        const rutInput = await driver.wait(until.elementLocated(By.css('input[name="rut"]')), 10000);
        await rutInput.sendKeys('26297437-5');

        const claveInput = await driver.findElement(By.css('input#inputPass'));
        await claveInput.sendKeys('krys55555');

        const ingresarBtn = await driver.findElement(By.css('button#bt_ingresar'));
        await ingresarBtn.click();
        await driver.sleep(4000);

        const currentUrl = await driver.getCurrentUrl();
        console.log('Después del login, URL actual:', currentUrl);

        // 3. Esperar hasta que el botón EMITIR esté disponible (pantalla de calculadora)
        await driver.wait(
            until.elementLocated(By.xpath('//button[contains(@class,"success") and contains(., "Emitir")]')),
            15000
        );

        for (const order of orders) {
            console.log(`Generando boleta para orden ${order.order_id}`);

            await driver.sleep(500);

            // Borrar lo anterior
            for (let i = 0; i < 10; i++) {
                await driver.actions({ async: true }).sendKeys(Key.BACK_SPACE).perform();
                await driver.sleep(100);
            }

            // Enviar monto con numpad
            const montoStr = "1";
            const montoTeclas = montoStr.split('').map((d: string) => numpadMap[d]);
            await driver.actions({ async: true }).sendKeys(...montoTeclas).perform();

            // Confirmar que cambió el monto (visual)
            await driver.wait(async () => {
                const span = await driver.findElement(By.xpath('//span[contains(text(), "$")]'));
                const text = await span.getText();
                return text.trim() !== '$ 0';
            }, 10000);



            // 5. Click en botón EMITIR
            const emitirBtn = await driver.findElement(By.xpath('//button[contains(@class,"success") and contains(., "Emitir")]'));
            await emitirBtn.click();

            // 6. Esperar sección de detalle
            // Esperar que aparezca el switch de "Detalle"
            // Esperar el div interactuable (padre del switch)
            // Esperar el "thumb" visible del switch
            await driver.sleep(2000);
            await driver.wait(until.elementLocated(By.css('.v-input--switch__thumb')), 10000);

            // Hacer clic sobre el elemento visual del switch
            // Esperar el input real del switch "Detalle"
            const inputSwitch = await driver.wait(
                until.elementLocated(By.css('input#input-135[type="checkbox"]')),
                10000
            );

            // Activar el switch mediante ejecución de JavaScript
            await driver.executeScript(`
    const input = arguments[0];
    if (!input.checked) {
        input.click();
    }
`, inputSwitch);

            // Esperar que el campo de descripción esté visible
            await driver.wait(until.elementLocated(By.css('#input-139')), 10000);
            await driver.sleep(1000); // dar tiempo para que se muestre el campo



            // Esperar campo visible para descripción
            await driver.wait(until.elementLocated(By.xpath('//input[@id="input-139"]')), 10000);

            // Ingresar descripción
            const descripcion = (order.product_quantity + " " + order.product_title).slice(0, 80);
            const detalleInput = await driver.findElement(By.xpath('//input[@id="input-139"]'));
            await detalleInput.sendKeys(descripcion);

            await driver.sleep(1000); // dar tiempo para que se muestre el campo
            console.log(`Boleta lista para orden ${order.order_id} (detenida antes de emitir).`);
            // Esperar botón final "Emitir"
            // Esperar el DIV contenedor del botón "EMITIR"
            const botonFinalEmitir = await driver.wait(
                until.elementLocated(By.xpath('//button[.//span[text()[normalize-space(.) = "EMITIR"]]')),
                10000
            );
            await driver.executeScript('arguments[0].scrollIntoView({ behavior: "smooth", block: "center" });', botonFinalEmitir);
            await driver.sleep(500); // Espera la animación
            await driver.executeScript('arguments[0].click();', botonFinalEmitir);
            
            await driver.wait(
                until.elementLocated(By.xpath('//div[contains(text(), "Boleta generada")]')),
                15000
            );
            
            console.log(`✅ Boleta emitida para orden ${order.order_id}.`);

        }

        // await driver.quit(); // Para visualizar el resultado sin cerrar

    } catch (error) {
        console.error('Error durante el proceso de boletas:', error);
    } finally {
        client.release();
    }
}
