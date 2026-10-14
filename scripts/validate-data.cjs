'use strict';
const fs = require('node:fs');
const { validateSnapshot } = require('../macro-data.js');
validateSnapshot(JSON.parse(fs.readFileSync(require('node:path').join(__dirname, '../data/economic-data.json'), 'utf8')));
console.log('Economic snapshot validation passed.');
