import {build} from 'esbuild'
import {createHash} from 'node:crypto'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {dirname,join,relative,resolve} from 'node:path'

// Build only the two source-reviewed functions in this candidate. No credentials,
// provider requests or deployment are involved in packaging.
const out=resolve('tmp/operations-review/edge-release')
await mkdir(join(out,'document-pdf'),{recursive:true})
const result=await build({entryPoints:['supabase/functions/document-pdf/index.ts'],bundle:true,platform:'neutral',format:'esm',target:'es2022',write:false,logLevel:'silent',plugins:[{name:'deno-runtime-imports',setup(b){
 b.onResolve({filter:/^npm:/},args=>({path:args.path,external:true}))
 b.onResolve({filter:/^pdf-lib$/},()=>({path:'npm:pdf-lib@1.17.1',external:true}))
 b.onResolve({filter:/^@pdf-lib\/fontkit$/},()=>({path:'npm:@pdf-lib/fontkit@1.1.1',external:true}))
 b.onResolve({filter:/fonts\/dejavuSans\.ts$/},()=>({path:'./font-data.ts',external:true}))
}}]})
await writeFile(join(out,'document-pdf/index.js'),result.outputFiles[0].text)
await writeFile(join(out,'document-pdf/font-data.ts'),await readFile('shared/fonts/dejavuSans.ts'))
await writeFile(join(out,'document-pdf/deno.json'),'{}\n')

const visited=new Set()
async function copyModule(file){
 file=resolve(file)
 const root=resolve('supabase/functions')
 if(!file.startsWith(root+'/'))throw Error('Function dependency left its source directory')
 if(visited.has(file))return
 visited.add(file)
 const content=await readFile(file,'utf8'),dest=join(out,'fin-workflow/functions',relative(root,file))
 await mkdir(dirname(dest),{recursive:true});await writeFile(dest,content)
 for(const match of content.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g))await copyModule(resolve(dirname(file),match[1]))
}
await copyModule('supabase/functions/fin-workflow/index.ts')
const functions=[
 {name:'document-pdf',verify_jwt:false,entrypoint_path:'index.js',import_map_path:'deno.json',files:['index.js','font-data.ts','deno.json']},
 {name:'fin-workflow',verify_jwt:true,entrypoint_path:'functions/fin-workflow/index.ts',files:[...visited].map(p=>'functions/'+relative(resolve('supabase/functions'),p)).sort()},
]
for(const f of functions)f.file_hashes=await Promise.all(f.files.map(async path=>({path,sha256:createHash('sha256').update(await readFile(join(out,f.name,path))).digest('hex')})))
await writeFile(join(out,'manifest.json'),JSON.stringify({functions},null,2)+'\n')
console.log('Prepared credential-free candidate Edge packages:',functions.map(f=>f.name+' ('+f.files.length+' files)').join(', '))
