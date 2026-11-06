'use strict';
function normalize(value = {}) {
  return { enabled: value?.enabled === true, style: value?.style === 'grid' ? 'grid' : 'tree' };
}
module.exports = { normalize };
