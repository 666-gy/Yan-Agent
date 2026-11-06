'use strict';
const fs=require('node:fs'),path=require('node:path');
// Exercise the application panel, independently of the first-run welcome animation.
module.exports = profile => {
 const data=path.join(profile,'YanData');fs.mkdirSync(data,{recursive:true});
 fs.writeFileSync(path.join(data,'config.json'),JSON.stringify({general:{startupAnimation:false}}));
};
