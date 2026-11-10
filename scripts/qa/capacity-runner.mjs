import {main} from './replay-migrations.mjs'
main({capacity:true}).catch(error=>{console.error(error.message);process.exitCode=1})
