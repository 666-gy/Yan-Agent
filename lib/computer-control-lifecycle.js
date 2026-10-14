'use strict';
// Main-process lifecycle bus. Computer-control cleanup never owns or aborts runs.
const { EventEmitter } = require('node:events');
module.exports = new EventEmitter();
