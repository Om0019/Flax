const express = require('express');
const path = require('path');

const PORT = process.env.PORT || 7010;
const app = express();

app.use((_, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

app.options('*', (_, res) => {
    res.sendStatus(204);
});

app.use('/providers', express.static(path.join(__dirname, 'providers')));
app.use('/Assets', express.static(path.join(__dirname, 'Assets')));

app.get('/manifest.json', (_, res) => {
    res.sendFile(path.join(__dirname, 'manifest.json'));
});

app.get('/', (_, res) => {
    res.type('text/plain').send([
        'Flax Nuvio plugin repository',
        '',
        `Manifest: http://127.0.0.1:${PORT}/manifest.json`,
        `Providers: http://127.0.0.1:${PORT}/providers/<provider>.js`,
    ].join('\n'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Nuvio plugin manifest: http://127.0.0.1:${PORT}/manifest.json`);
});
