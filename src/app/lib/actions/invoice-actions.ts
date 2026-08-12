import { Builder, By, until, Key } from 'selenium-webdriver';
import type { Locator, WebDriver, WebElement } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome';
import pool from '@/app/lib/db';
import type { PoolClient } from 'pg';
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
    let driver: WebDriver | null = null;

    try {
        const { rows: orderHeaders } = await client.query(
            `SELECT *
             FROM order_header
             WHERE has_invoice = false
               AND document_type IN ($1, $2)
               -- TODO: quitar 'pendiente' antes de procesar documentos en producciÃ³n.
               AND status IN ($3, $4, $5)
               AND COALESCE(return_status, 'sin_devolucion') = 'sin_devolucion'
             ORDER BY created_at ASC`,
            ['factura', 'boleta', 'enviado', 'recibido', 'pendiente']
        );

        if (orderHeaders.length === 0) {
            console.log('No hay Ã³rdenes pendientes de factura.');
            return;
        }

        const options = new chrome.Options();
        options.addArguments('--start-maximized');
        options.setUserPreferences({ 'profile.default_content_setting_values.notifications': 2 });



        driver = await new Builder()
            .forBrowser('chrome')
            .setChromeOptions(options)
            .build();

        const invoiceHeaders = orderHeaders.filter(
            (order) => order.document_type === 'factura'
        );
        if (invoiceHeaders.length > 0) {
            await loginSiiFactura(driver);
        }

        for (const header of invoiceHeaders) {
            const { rows: details } = await client.query(
                `SELECT *
                 FROM order_detail
                 WHERE id_order_header = $1
                 ORDER BY id ASC`,
                [header.id]
            );

            const shippingAmount = Number(header.shipping_amount ?? 0);
            const invoiceDetails = groupInvoiceDetails(details);

            if (shippingAmount > 0) {
                invoiceDetails.push({
                    product_title: 'Envio',
                    product_quantity: 1,
                    product_price: shippingAmount
                });
            }

            await fillSiiInvoiceForm(driver, header, invoiceDetails);
            await signDownloadAndSaveInvoice(driver, client, header);
            console.log(
                `Factura de la orden ${header.order_id} emitida y guardada correctamente`
            );

            await driver.get(SII_NEW_INVOICE_URL);
        }

        const receiptHeaders = orderHeaders.filter(
            (order) => order.document_type === 'boleta'
        );
        if (receiptHeaders.length > 0) {
            await loginSiiBoleta(driver);
            await processReceipts(driver, client, receiptHeaders);
        }

        // El flujo de boletas se conserva comentado para implementarlo despuÃ©s.
        /*
        await driver.get('https://eboleta.sii.cl/emitir/');
        await driver.sleep(2000);



        const rutInput = await driver.wait(until.elementLocated(By.css('input[name="rut"]')), 10000);
        await rutInput.sendKeys(process.env.SII_RUT!);

        const claveInput = await driver.findElement(By.css('input#inputPass'));
        await claveInput.sendKeys(process.env.SII_PASS!);

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

            const montoTotal = (header.total_amount + header.shipping_amount).toFixed(0).toString();
            //const montoTotal = "1";
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

            console.log(`âœ… Boleta emitida para orden ${header.order_id}`);

            const downloadBtn = await driver.findElement(By.xpath('//a[contains(., "Descargar")]'));
            const downloadUrl = await downloadBtn.getAttribute('href');

            if (!downloadUrl) {
                console.error(`âŒ No se encontrÃ³ enlace de descarga para orden ${header.order_id}`);
                continue;
            }

            const response = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
            const pdfBuffer = Buffer.from(response.data);

            await client.query(
                'UPDATE order_header SET invoice_pdf = $1, has_invoice = true WHERE id = $2',
                [pdfBuffer, header.id]
            );

            console.log(`ðŸ“‚ Boleta guardada en base de datos para orden ${header.order_id}`);

            try {
                const closeBtn = await driver.wait(
                    until.elementLocated(By.xpath('//i[contains(text(), "close")]')),
                    10000
                );
                await closeBtn.click();
                await driver.sleep(2000);
            } catch (e) {
                console.error('âŒ No se pudo cerrar la boleta con la X:', e);
            }
        }
            */

    } catch (error) {
        console.error('Error durante el proceso de documentos tributarios:', error);
        throw error;
    } finally {
        if (driver && process.env.SII_KEEP_BROWSER_OPEN !== 'true') {
            await driver.quit();
        }
        client.release();
    }
}

interface InvoiceHeader {
    id: string;
    order_id: string;
    company_rut: string | null;
    billing_city: string | null;
    shipping_amount: unknown;
    total_amount: unknown;
}

async function loginSiiBoleta(driver: WebDriver) {
    const siiRut = process.env.SII_RUT;
    const siiPass = process.env.SII_PASS;

    if (!siiRut || !siiPass) {
        throw new Error('SII_RUT y SII_PASS deben estar configuradas para emitir boletas.');
    }

    await driver.get(SII_BOLETA_URL);
    const rutInputs = await driver.findElements(By.css('input[name="rut"]'));

    if (rutInputs.length > 0) {
        await replaceInputValue(driver, By.css('input[name="rut"]'), siiRut);
        await replaceInputValue(driver, By.css('input#inputPass'), siiPass);

        const loginButton = await driver.wait(
            until.elementLocated(By.css('button#bt_ingresar')),
            10000
        );
        await driver.wait(until.elementIsVisible(loginButton), 10000);
        await driver.wait(until.elementIsEnabled(loginButton), 10000);
        await waitForBoletaOverlay(driver);

        const clickableLoginButton = await driver.findElement(By.css('button#bt_ingresar'));
        await driver.executeScript(
            'arguments[0].scrollIntoView({ block: "center" });',
            clickableLoginButton
        );
        await waitForBoletaOverlay(driver);
        await clickableLoginButton.click();
    }

    const issueButton = await driver.wait(
        until.elementLocated(
            By.xpath('//button[contains(@class,"success") and contains(., "Emitir")]')
        ),
        20000
    );
    await driver.wait(until.elementIsVisible(issueButton), 10000);
    await driver.wait(until.elementIsEnabled(issueButton), 10000);
    console.log('Ingreso al portal de boletas realizado correctamente.');
}

async function processReceipts(
    driver: WebDriver,
    client: PoolClient,
    headers: InvoiceHeader[]
) {
    for (const header of headers) {
        const { rows: rawDetails } = await client.query(
            `SELECT *
             FROM order_detail
             WHERE id_order_header = $1
             ORDER BY id ASC`,
            [header.id]
        );
        const details = groupInvoiceDetails(rawDetails);
        const total = Number(header.total_amount ?? 0) + Number(header.shipping_amount ?? 0);

        if (!Number.isFinite(total) || total <= 0) {
            throw new Error(`La boleta de la orden ${header.order_id} tiene un total invÃ¡lido`);
        }

        const issueButtonLocator = By.xpath(
            '//button[contains(@class,"success") and contains(., "Emitir")]'
        );
        const issueButton = await driver.wait(
            until.elementLocated(issueButtonLocator),
            15000
        );
        await driver.wait(until.elementIsVisible(issueButton), 10000);
        await driver.wait(async () => {
            const className = await issueButton.getAttribute('class');
            return !className.includes('v-btn--loading');
        }, 15000);
        const clearButton = await driver.findElement(
            By.xpath('//button[.//i[normalize-space()="delete"]]')
        );
        await driver.executeScript('arguments[0].click();', clearButton);
        const roundedTotal = String(Math.round(total));

        for (const digit of roundedTotal) {
            const digitButton = await driver.findElement(
                By.xpath(
                    `//button[contains(@class,"green") and .//span[normalize-space()="${digit}"]]`
                )
            );
            await driver.executeScript('arguments[0].click();', digitButton);
        }

        await driver.wait(async () => {
            const amount = await driver.findElement(By.xpath('//span[contains(text(), "$")]'));
            const displayedAmount = (await amount.getText()).replace(/\D/g, '');
            return displayedAmount === roundedTotal;
        }, 15000);

        const readyIssueButton = await driver.wait(async () => {
            const button = await driver.findElement(issueButtonLocator);
            const className = await button.getAttribute('class');
            const disabled = await button.getAttribute('disabled');
            return !className.includes('v-btn--loading') && disabled === null
                ? button
                : false;
        }, 20000);
        await driver.executeScript(
            'arguments[0].scrollIntoView({ block: "center" }); arguments[0].click();',
            readyIssueButton
        );

        const detailLabel = await driver.wait(
            until.elementLocated(By.xpath('//label[normalize-space()="Detalle"]')),
            15000
        );
        await driver.wait(until.elementIsVisible(detailLabel), 10000);
        const detailSwitchId = await detailLabel.getAttribute('for');
        if (!detailSwitchId) {
            throw new Error('No se encontrÃ³ el interruptor Detalle de e-Boleta');
        }
        const detailSwitch = await driver.findElement(By.id(detailSwitchId));
        if (!(await detailSwitch.isSelected())) {
            await driver.executeScript('arguments[0].click();', detailSwitch);
        }

        const descriptionInput = await driver.wait(
            until.elementLocated(
                By.xpath(
                    '//label[normalize-space()="Detalle"]' +
                    '/ancestor::div[contains(@class,"v-input")]' +
                    '/following::input[@type="text" and not(@readonly) and not(@disabled)][1]'
                )
            ),
            15000
        );
        await driver.wait(until.elementIsVisible(descriptionInput), 10000);
        const description = details
            .map((detail) => `${detail.product_quantity} ${detail.product_title}`)
            .join(' - ')
            .slice(0, 80);
        await descriptionInput.sendKeys(description);

        await driver.actions({ async: true }).sendKeys(Key.TAB).perform();
        await driver.actions({ async: true }).sendKeys(Key.ENTER).perform();
        await driver.wait(
            until.elementLocated(By.xpath('//div[contains(text(), "Boleta generada")]')),
            20000
        );

        await client.query(
            `UPDATE order_header
             SET has_invoice = true,
                 updated_at = NOW()
             WHERE id = $1`,
            [header.id]
        );

        const downloadLink = await driver.wait(
            until.elementLocated(By.xpath('//a[contains(., "Descargar")]')),
            10000
        );
        const downloadUrl = await downloadLink.getAttribute('href');
        if (!downloadUrl) {
            throw new Error(`El SII no entregÃ³ la boleta PDF de la orden ${header.order_id}`);
        }

        const cookies = await driver.manage().getCookies();
        const absoluteDownloadUrl = new URL(
            downloadUrl,
            await driver.getCurrentUrl()
        ).toString();
        const response = await axios.get<ArrayBuffer>(absoluteDownloadUrl, {
            responseType: 'arraybuffer',
            headers: {
                Cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; '),
            },
        });
        const pdfBuffer = Buffer.from(response.data);
        if (pdfBuffer.length < 4 || pdfBuffer.subarray(0, 4).toString('ascii') !== '%PDF') {
            throw new Error(`La descarga de la orden ${header.order_id} no contiene un PDF vÃ¡lido`);
        }

        await client.query(
            `UPDATE order_header
             SET invoice_pdf = $1,
                 invoice_uploaded = false,
                 updated_at = NOW()
             WHERE id = $2`,
            [pdfBuffer, header.id]
        );
        console.log(`Boleta de la orden ${header.order_id} emitida y guardada correctamente`);

        const closeButton = await driver.wait(
            until.elementLocated(By.xpath('//i[contains(text(), "close")]')),
            10000
        );
        await driver.wait(until.elementIsVisible(closeButton), 10000);
        await closeButton.click();
    }
}

async function signDownloadAndSaveInvoice(
    driver: WebDriver,
    client: PoolClient,
    header: InvoiceHeader
) {
    const certificatePassword = process.env.SII_CERT_PASSWORD;

    if (!certificatePassword) {
        throw new Error(
            'La variable de entorno SII_CERT_PASSWORD no estÃƒÂ¡ configurada.'
        );
    }

    const previewSignButton = await driver.wait(
        until.elementLocated(By.name('btnSign')),
        15000
    );
    await driver.wait(until.elementIsVisible(previewSignButton), 10000);
    await driver.wait(until.elementIsEnabled(previewSignButton), 10000);
    await previewSignButton.click();

    await driver.wait(async () => {
        const currentUrl = await driver.getCurrentUrl();
        return currentUrl.includes('mipeGenXMLFirma.cgi');
    }, 20000);

    const centralCertificateButton = await driver.findElements(By.id('myButton1'));
    if (
        centralCertificateButton.length > 0 &&
        await centralCertificateButton[0].isDisplayed()
    ) {
        await centralCertificateButton[0].click();
    }

    await replaceInputValue(
        driver,
        By.id('myPass'),
        certificatePassword
    );

    const signButton = await driver.wait(
        until.elementLocated(By.id('btnFirma')),
        10000
    );
    await driver.wait(until.elementIsVisible(signButton), 10000);
    await driver.wait(until.elementIsEnabled(signButton), 10000);
    await signButton.click();

    try {
        await driver.wait(async () => {
            const title = await driver.getTitle();
            const pdfLinks = await driver.findElements(
                By.css('a[href*="mipeDisplayPDF.cgi"]')
            );
            return title.includes('Documento Firmado y Enviado') || pdfLinks.length > 0;
        }, 30000);
    } catch (error) {
        await throwSiiAlertIfPresent(driver, 'firma');
        throw error;
    }

    await client.query(
        `UPDATE order_header
         SET has_invoice = true,
             updated_at = NOW()
         WHERE id = $1`,
        [header.id]
    );

    const pdfLink = await driver.wait(
        until.elementLocated(By.css('a[href*="mipeDisplayPDF.cgi"]')),
        15000
    );
    await driver.wait(until.elementIsVisible(pdfLink), 10000);

    const relativePdfUrl = await pdfLink.getAttribute('href');
    if (!relativePdfUrl) {
        throw new Error(`El SII no entregÃƒÂ³ el PDF para la orden ${header.order_id}`);
    }

    const signedDocumentUrl = await driver.getCurrentUrl();
    const pdfUrl = new URL(relativePdfUrl, signedDocumentUrl).toString();
    const originalWindow = await driver.getWindowHandle();
    const windowsBeforeClick = await driver.getAllWindowHandles();

    await pdfLink.click();
    await driver.wait(async () => {
        const windows = await driver.getAllWindowHandles();
        return windows.length > windowsBeforeClick.length;
    }, 15000);

    const pdfWindow = (await driver.getAllWindowHandles()).find(
        (windowHandle) => !windowsBeforeClick.includes(windowHandle)
    );

    if (!pdfWindow) {
        throw new Error('El SII no abriÃƒÂ³ la pestaÃƒÂ±a del PDF');
    }

    try {
        await driver.switchTo().window(pdfWindow);
        await driver.wait(async () => {
            const currentUrl = await driver.getCurrentUrl();
            return currentUrl.includes('mipeDisplayPDF.cgi');
        }, 15000);

        const cookies = await driver.manage().getCookies();
        const cookieHeader = cookies
            .map((cookie) => `${cookie.name}=${cookie.value}`)
            .join('; ');
        const response = await axios.get<ArrayBuffer>(pdfUrl, {
            responseType: 'arraybuffer',
            headers: { Cookie: cookieHeader },
        });
        const pdfBuffer = Buffer.from(response.data);

        if (
            pdfBuffer.length < 4 ||
            pdfBuffer.subarray(0, 4).toString('ascii') !== '%PDF'
        ) {
            throw new Error(
                `La descarga de la orden ${header.order_id} no contiene un PDF vÃƒÂ¡lido`
            );
        }

        await client.query(
             `UPDATE order_header
             SET invoice_pdf = $1,
                 invoice_uploaded = false,
                 updated_at = NOW()
             WHERE id = $2`,
            [pdfBuffer, header.id]
        );
    } finally {
        await driver.close();
        await driver.switchTo().window(originalWindow);
    }
}

async function throwSiiAlertIfPresent(driver: WebDriver, stage: string) {
    try {
        const alert = await driver.switchTo().alert();
        const alertText = await alert.getText();
        await alert.accept();
        throw new Error(`El SII rechazÃƒÂ³ la ${stage}: ${alertText}`);
    } catch (error) {
        if (
            error instanceof Error &&
            error.message.startsWith('El SII rechazÃƒÂ³')
        ) {
            throw error;
        }
    }
}

interface InvoiceDetail {
    product_title: unknown;
    product_quantity: unknown;
    product_price: unknown;
}

function groupInvoiceDetails(details: InvoiceDetail[]): InvoiceDetail[] {
    const groupedDetails = new Map<string, InvoiceDetail>();

    for (const detail of details) {
        const title = String(detail.product_title ?? '').trim();
        const unitPrice = Number(detail.product_price);
        const quantity = Number(detail.product_quantity);
        const key = `${title.toLocaleLowerCase('es-CL')}\u0000${unitPrice}`;
        const existingDetail = groupedDetails.get(key);

        if (existingDetail) {
            existingDetail.product_quantity =
                Number(existingDetail.product_quantity) + quantity;
            continue;
        }

        groupedDetails.set(key, {
            ...detail,
            product_title: title,
            product_quantity: quantity,
            product_price: unitPrice,
        });
    }

    return [...groupedDetails.values()];
}

interface SplitRut {
    number: string;
    dv: string;
}

async function waitForBoletaOverlay(driver: WebDriver) {
    await driver.wait(async () => {
        const overlays = await driver.findElements(By.css('div.transparencia'));

        for (const overlay of overlays) {
            try {
                if (await overlay.isDisplayed()) {
                    return false;
                }
            } catch {
                // La capa fue reemplazada por la aplicaciÃ³n; se vuelve a consultar.
                return false;
            }
        }

        return true;
    }, 20000, 'La capa de carga del portal de boletas no desapareciÃ³.');
}

export function splitChileanRut(value: unknown): SplitRut {
    if (typeof value !== 'string') {
        throw new Error('El RUT del receptor no es vÃ¡lido');
    }

    const normalized = value
        .trim()
        .replace(/\./g, '')
        .replace(/\s+/g, '')
        .toUpperCase();
    const match = normalized.match(/^(\d{7,8})-([\dK])$/);

    if (!match) {
        throw new Error(`Formato de RUT invÃ¡lido: ${value}`);
    }

    return { number: match[1], dv: match[2] };
}

function calculateRutDv(rutNumber: string): string {
    let sum = 0;
    let multiplier = 2;

    for (let index = rutNumber.length - 1; index >= 0; index -= 1) {
        sum += Number(rutNumber[index]) * multiplier;
        multiplier = multiplier === 7 ? 2 : multiplier + 1;
    }

    const result = 11 - (sum % 11);
    if (result === 11) return '0';
    if (result === 10) return 'K';
    return String(result);
}

async function waitForInput(
    driver: WebDriver,
    locator: Locator,
    timeout = 15000
): Promise<WebElement> {
    const element = await driver.wait(until.elementLocated(locator), timeout);
    await driver.wait(until.elementIsVisible(element), timeout);
    return element;
}

export async function replaceInputValue(
    driver: WebDriver,
    locator: Locator,
    value: string
): Promise<WebElement> {
    const element = await waitForInput(driver, locator);

    await driver.executeScript(
        `const input = arguments[0];
         input.focus();
         input.value = '';
         input.dispatchEvent(new Event('input', { bubbles: true }));`,
        element
    );
    await element.sendKeys(value);
    return element;
}

async function dispatchChangeAndBlur(driver: WebDriver, element: WebElement) {
    await driver.executeScript(
        `const input = arguments[0];
         input.dispatchEvent(new Event('input', { bubbles: true }));
         input.dispatchEvent(new Event('change', { bubbles: true }));
         input.blur();`,
        element
    );
}

function getDetailSuffix(index: number): string {
    return String(index + 1).padStart(2, '0');
}

export async function fillInvoiceDetail(
    driver: WebDriver,
    detail: InvoiceDetail,
    index: number
) {
    const title = String(detail.product_title ?? '').trim();
    const quantity = Number(detail.product_quantity);
    const grossUnitPrice = Number(detail.product_price);

    if (!title) {
        throw new Error(`El producto de la lÃ­nea ${index + 1} no tiene nombre`);
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error(`Cantidad invÃ¡lida en la lÃ­nea ${index + 1}`);
    }
    if (!Number.isFinite(grossUnitPrice) || grossUnitPrice <= 0) {
        throw new Error(`Precio invÃ¡lido en la lÃ­nea ${index + 1}`);
    }

    const suffix = getDetailSuffix(index);
    const productName = title.slice(0, 25);
    const netUnitPrice = Number((grossUnitPrice / 1.19).toFixed(6));

    if (title.length > 25) {
        console.warn(
            `El producto "${title}" supera 25 caracteres. Se utilizarÃ¡ "${productName}".`
        );
    }

    await replaceInputValue(driver, By.name(`EFXP_NMB_${suffix}`), productName);
    await replaceInputValue(driver, By.name(`EFXP_QTY_${suffix}`), String(quantity));
    const priceInput = await replaceInputValue(
        driver,
        By.name(`EFXP_PRC_${suffix}`),
        String(netUnitPrice)
    );
    await dispatchChangeAndBlur(driver, priceInput);
}

async function waitForReceiverLookup(driver: WebDriver) {
    await driver.wait(async () => {
        const loaders = await driver.findElements(By.css('#ocultaGifWait img'));
        return loaders.length === 0;
    }, 20000);

    const receiverCity = await driver.wait(
        until.elementLocated(By.name('EFXP_CIUDAD_RECEP')),
        15000
    );
    await driver.wait(until.elementIsVisible(receiverCity), 15000);
}

export async function fillSiiInvoiceForm(
    driver: WebDriver,
    header: InvoiceHeader,
    details: InvoiceDetail[]
) {
    if (!header.company_rut) {
        throw new Error(`La orden ${header.order_id} no tiene company_rut`);
    }
    if (!header.billing_city) {
        throw new Error(`La orden ${header.order_id} no tiene billing_city`);
    }
    if (details.length === 0) {
        throw new Error(`La orden ${header.order_id} no tiene productos`);
    }
    if (details.length > 10) {
        throw new Error(
            `La orden ${header.order_id} tiene ${details.length} lÃ­neas. El formulario permite 10.`
        );
    }

    const receiverRut = splitChileanRut(header.company_rut);
    if (calculateRutDv(receiverRut.number) !== receiverRut.dv) {
        throw new Error(
            `El RUT del receptor de la orden ${header.order_id} no es vÃ¡lido`
        );
    }

    await replaceInputValue(driver, By.id('EFXP_RUT_RECEP'), receiverRut.number);
    const dvInput = await replaceInputValue(
        driver,
        By.id('EFXP_DV_RECEP'),
        receiverRut.dv
    );

    await dispatchChangeAndBlur(driver, dvInput);
    await driver.actions({ async: true }).sendKeys(Key.TAB).perform();
    await waitForReceiverLookup(driver);

    await replaceInputValue(driver, By.name('EFXP_CIUDAD_ORIGEN'), 'Santiago');
    const issuerCity = await driver
        .findElement(By.name('EFXP_CIUDAD_ORIGEN'))
        .getAttribute('value');

    if (issuerCity.trim().toLowerCase() !== 'santiago') {
        throw new Error('No se pudo completar la ciudad del emisor');
    }

    const receiverCityInput = await waitForInput(
        driver,
        By.name('EFXP_CIUDAD_RECEP')
    );
    const readonly = await receiverCityInput.getAttribute('readonly');
    const disabled = await receiverCityInput.getAttribute('disabled');

    if (!readonly && !disabled) {
        await replaceInputValue(
            driver,
            By.name('EFXP_CIUDAD_RECEP'),
            header.billing_city.trim().slice(0, 15)
        );
    }

    for (let index = 0; index < details.length; index += 1) {
        if (index > 0) {
            const addLineButton = await driver.wait(
                until.elementLocated(By.name('AGREGA_DETALLE')),
                10000
            );
            await driver.wait(until.elementIsVisible(addLineButton), 10000);
            await driver.wait(until.elementIsEnabled(addLineButton), 10000);
            await addLineButton.click();

            await driver.wait(
                until.elementLocated(
                    By.name(`EFXP_NMB_${getDetailSuffix(index)}`)
                ),
                10000
            );
        }

        await fillInvoiceDetail(driver, details[index], index);
    }

    await driver.wait(async () => {
        const total = await driver
            .findElement(By.name('EFXP_MNT_TOTAL'))
            .getAttribute('value');
        return Boolean(total && Number(total.replace(/[^\d.-]/g, '')) > 0);
    }, 15000);

    const validateButton = await driver.wait(
        until.elementLocated(By.name('Button_Update')),
        10000
    );
    await driver.wait(until.elementIsVisible(validateButton), 10000);
    await driver.wait(until.elementIsEnabled(validateButton), 10000);
    await validateButton.click();

    try {
        await driver.wait(async () => {
            const currentUrl = await driver.getCurrentUrl();
            return currentUrl.includes('mipeDisplayPreView.cgi');
        }, 20000);
    } catch (error) {
        try {
            const alert = await driver.switchTo().alert();
            const alertText = await alert.getText();
            await alert.accept();
            throw new Error(`El SII rechazÃ³ la validaciÃ³n: ${alertText}`);
        } catch (alertError) {
            if (
                alertError instanceof Error &&
                alertError.message.startsWith('El SII rechazÃ³')
            ) {
                throw alertError;
            }
        }

        throw error;
    }
}

const SII_FACTURA_URL =
    'https://zeusr.sii.cl/AUT2000/InicioAutenticacion/IngresoRutClave.html' +
    '?https://www1.sii.cl/cgi-bin/Portal001/mipeSelEmpresa.cgi' +
    '?DESDE_DONDE_URL=OPCION%3D33%26TIPO%3D4';

const SII_NEW_INVOICE_URL =
    'https://www1.sii.cl/cgi-bin/Portal001/mipeGenFacEx.cgi?PTDC_CODIGO=33';

const SII_BOLETA_URL = 'https://eboleta.sii.cl/emitir/';

async function loginSiiFactura(driver: import('selenium-webdriver').WebDriver) {
    const siiRut = process.env.SII_RUT;
    const siiPass = process.env.SII_PASS;

    if (!siiRut) {
        throw new Error('La variable de entorno SII_RUT no estÃ¡ configurada.');
    }

    if (!siiPass) {
        throw new Error('La variable de entorno SII_PASS no estÃ¡ configurada.');
    }

    await driver.get(SII_FACTURA_URL);

    const rutInput = await driver.wait(
        until.elementLocated(By.id('rutcntr')),
        15000,
        'No se encontrÃ³ el campo RUT del SII.'
    );

    await driver.wait(
        until.elementIsVisible(rutInput),
        5000
    );

    await rutInput.clear();
    await rutInput.sendKeys(siiRut);

    const claveInput = await driver.wait(
        until.elementLocated(By.id('clave')),
        10000,
        'No se encontrÃ³ el campo de Clave Tributaria.'
    );

    await driver.wait(
        until.elementIsVisible(claveInput),
        5000
    );

    await claveInput.clear();
    await claveInput.sendKeys(siiPass);

    const ingresarBtn = await driver.wait(
        until.elementLocated(By.id('bt_ingresar')),
        10000,
        'No se encontrÃ³ el botÃ³n Ingresar.'
    );

    await driver.wait(
        until.elementIsEnabled(ingresarBtn),
        5000
    );

    await ingresarBtn.click();

    try {
        await driver.wait(async () => {
            const currentUrl = await driver.getCurrentUrl();

            return !currentUrl.includes(
                '/AUT2000/InicioAutenticacion/IngresoRutClave.html'
            );
        }, 20000);
    } catch {
        const alertas = await driver.findElements(
            By.css('#alert_placeholder')
        );

        let mensaje = '';

        if (alertas.length > 0) {
            mensaje = (await alertas[0].getText()).trim();
        }

        throw new Error(
            mensaje
                ? `El SII rechazÃ³ el ingreso: ${mensaje}`
                : 'El SII no avanzÃ³ despuÃ©s de presionar Ingresar.'
        );
    }

    console.log('Ingreso al SII realizado correctamente.');
}
