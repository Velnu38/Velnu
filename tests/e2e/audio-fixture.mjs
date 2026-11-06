// A real, decodable one-second PCM fixture. Recorder/API responses remain mocked;
// Web Audio decoding and resampling run in the browser under test.
export async function installPcmFixture(page){await page.addInitScript(()=>{
 window.__pcmFixture=()=>{const bytes=new Uint8Array(44+32000),v=new DataView(bytes.buffer);for(const[n,s]of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']])for(let i=0;i<s.length;i++)bytes[n+i]=s.charCodeAt(i);for(const[n,x]of [[4,bytes.length-8],[16,16],[24,16000],[28,32000],[40,32000]])v.setUint32(n,x,true);for(const[n,x]of [[20,1],[22,1],[32,2],[34,16]])v.setUint16(n,x,true);return bytes}
})}
