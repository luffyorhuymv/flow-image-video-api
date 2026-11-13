const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const USER_DATA_DIR = path.join(__dirname, 'flow-browser-profile');

console.log('1. Starting test...');
console.log('2. User data dir:', USER_DATA_DIR);

if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    console.log('3. Created profile dir');
}

console.log('4. Launching persistent context...');

chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    viewport: { width: 1400, height: 900 },
    args: ['--disable-blink-features=AutomationControlled']
}).then(context => {
    console.log('5. Context launched!');
    console.log('   Pages:', context.pages().length);
    
    const page = context.pages()[0] || context.newPage();
    console.log('6. Got page');
    
    page.goto('https://flow.google.com/').then(() => {
        console.log('7. Navigated to flow.google.com');
        return page.waitForLoadState('networkidle');
    }).then(() => {
        console.log('8. Page loaded');
        console.log('   URL:', page.url());
        console.log('   Title:', page.title());
        
        // Keep open for 20 seconds
        setTimeout(() => {
            console.log('9. Closing...');
            context.close();
            console.log('10. Done!');
            process.exit(0);
        }, 20000);
    }).catch(err => {
        console.error('Error:', err);
        context.close();
        process.exit(1);
    });
}).catch(err => {
    console.error('Launch error:', err);
    process.exit(1);
});

console.log('Script initiated (async)');