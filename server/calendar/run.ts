import { setTimeout } from 'node:timers/promises'
import { runSyncBatch } from './worker.js'
import { database } from './db.js'
import { log } from './errors.js'
let stopping=false
process.on('SIGTERM',()=>{stopping=true})
process.on('SIGINT',()=>{stopping=true})
if(process.env.CALENDAR_SYNC_ENABLED!=='true')throw new Error('Calendar sync must be configured before starting the worker')
// A durable queue is the event listener. Short idle polling avoids an additional queue service.
while(!stopping){
  try{const result=await runSyncBatch();if(!result.processed)await setTimeout(2000)}
  catch{log('sync_failed',{reason:'worker_iteration_failed',retryable:true});await setTimeout(5000)}
}
await database().end()
