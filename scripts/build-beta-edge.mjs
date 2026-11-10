import {build} from 'esbuild'
import {createHash} from 'node:crypto'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {dirname,join,relative,resolve} from 'node:path'

// Reproduce only this candidate's runtime packages. No credentials, provider
// requests, configuration changes or deployment are involved in packaging.
const sourceRoot=resolve(process.argv[2]||'.')
const out=resolve(process.argv[3]||'tmp/operations-review/edge-release')
// Every sending entry point can be the first caller to freeze a document PDF.
// Keep their renderer identical while preserving each existing authentication mode.
const renderers=[['document-pdf',false],['send-document-email',true],['send-invoice-email',true],['send-invoice-reminder',true],['email-recovery-worker',false],['tier-delivery-worker',false],['work-scheduling',false],['business-card-delivery',true],['send-business-card',true]]
const functions=[]
for(const [name,verify_jwt] of renderers){
 await mkdir(join(out,name),{recursive:true})
 const result=await build({entryPoints:[join(sourceRoot,'supabase/functions',name,'index.ts')],bundle:true,platform:'neutral',format:'esm',target:'es2022',write:false,logLevel:'silent',plugins:[{name:'deno-runtime-imports',setup(b){
  b.onResolve({filter:/^npm:/},args=>({path:args.path,external:true}))
  b.onResolve({filter:/^pdf-lib$/},()=>({path:'npm:pdf-lib@1.17.1',external:true}))
  b.onResolve({filter:/^@pdf-lib\/fontkit$/},()=>({path:'npm:@pdf-lib/fontkit@1.1.1',external:true}))
  b.onResolve({filter:/fonts\/dejavuSans\.ts$/},()=>({path:'./font-data.ts',external:true}))
 }}]})
 await writeFile(join(out,name,'index.js'),result.outputFiles[0].text)
 await writeFile(join(out,name,'font-data.ts'),await readFile(join(sourceRoot,'shared/fonts/dejavuSans.ts')))
 await writeFile(join(out,name,'deno.json'),'{}\n')
 functions.push({name,verify_jwt,entrypoint_path:'index.js',import_map_path:'deno.json',files:['index.js','font-data.ts','deno.json']})
}
const visited=new Set()
async function copyModule(file){
 file=resolve(file)
 const root=join(sourceRoot,'supabase/functions')
 if(!file.startsWith(root+'/'))throw Error('Function dependency left its source directory')
 if(visited.has(file))return
 visited.add(file)
 const content=await readFile(file,'utf8'),dest=join(out,'fin-workflow/functions',relative(root,file))
 await mkdir(dirname(dest),{recursive:true});await writeFile(dest,content)
 for(const match of content.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g))await copyModule(resolve(dirname(file),match[1]))
}
await copyModule(join(sourceRoot,'supabase/functions/fin-workflow/index.ts'))
functions.push({name:'fin-workflow',verify_jwt:true,entrypoint_path:'functions/fin-workflow/index.ts',files:[...visited].map(p=>'functions/'+relative(join(sourceRoot,'supabase/functions'),p)).sort()})
for(const f of functions)f.file_hashes=await Promise.all(f.files.map(async path=>({path,sha256:createHash('sha256').update(await readFile(join(out,f.name,path))).digest('hex')})))
await writeFile(join(out,'manifest.json'),JSON.stringify({functions},null,2)+'\n')
console.log('Prepared credential-free candidate Edge packages:',functions.map(f=>f.name+' ('+f.files.length+' files)').join(', '))
