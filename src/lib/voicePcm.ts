/** Normalize browser recorder formats to bounded PCM for server-verified duration. */
export async function voicePcm(audio:Blob):Promise<{audio:Blob;seconds:number}>{
 const context=new AudioContext()
 try{
  const decoded=await context.decodeAudioData(await audio.arrayBuffer())
  if(!Number.isFinite(decoded.duration)||decoded.duration<=0||decoded.duration>120.5)throw new Error('Record a voice request of two minutes or less.')
  const length=Math.min(120*16000,Math.ceil(decoded.duration*16000)),offline=new OfflineAudioContext(1,length,16000),source=offline.createBufferSource();source.buffer=decoded;source.connect(offline.destination);source.start()
  const output=await offline.startRendering(),samples=output.getChannelData(0),buffer=new ArrayBuffer(44+samples.length*2),v=new DataView(buffer)
  const text=(offset:number,value:string)=>{for(let i=0;i<value.length;i++)v.setUint8(offset+i,value.charCodeAt(i))}
  text(0,'RIFF');v.setUint32(4,buffer.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,samples.length*2,true)
  for(let i=0;i<samples.length;i++){const n=Math.max(-1,Math.min(1,samples[i]));v.setInt16(44+i*2,Math.round(n*(n<0?32768:32767)),true)}
  return{audio:new Blob([buffer],{type:'audio/wav'}),seconds:samples.length/16000}
 }catch(e){throw e instanceof Error?e:new Error('This device could not prepare the recording. Try again or type your request.')}finally{try{await context.close()}catch{/* Cleanup cannot invalidate a normalized recording. */}}
}
