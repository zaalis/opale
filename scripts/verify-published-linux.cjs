'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Updater}=require('../lib/updater');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'opale-published-linux-'));
(async()=>{
 const current=new Updater({home,installed:true});
 try {const state=await current.check();if(state.phase!=='current')throw Error(JSON.stringify(state));console.log('PASS published Linux branch identifies installed 0.2.0 as current');}finally{current.close();}
 const previous=new Updater({home,installed:true,buildId:'0'.repeat(64),builtAt:0});
 try{const state=await previous.check();if(state.phase!=='ready')throw Error(JSON.stringify(state));console.log('PASS real Linux archive downloaded and SHA-256 verified: '+fs.statSync(previous.path).size+' bytes; commit '+state.commit);}finally{previous.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>fs.rmSync(home,{recursive:true,force:true}));
