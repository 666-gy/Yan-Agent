'use strict';
async function bounded(operation, ms = 5000) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Lifecycle cleanup timed out')), ms);
    })]);
  } finally { clearTimeout(timer); }
}
module.exports = { bounded };
