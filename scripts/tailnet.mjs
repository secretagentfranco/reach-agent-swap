import net from 'node:net';
import {execFileSync} from 'node:child_process';
import {writeFileSync,unlinkSync} from 'node:fs';
const host=execFileSync('tailscale',['ip','-4'],{encoding:'utf8'}).trim().split('\n')[0];
const octets=host.split('.').map(Number);
if(octets.length!==4||octets[0]!==100||octets[1]<64||octets[1]>127||octets.some(n=>!Number.isInteger(n)||n<0||n>255))throw Error('A local Tailscale IPv4 address is required');
const connections=new Set();
const server=net.createServer(client=>{
  const upstream=net.connect({host:'127.0.0.1',port:5179});
  connections.add(client);connections.add(upstream);
  client.pipe(upstream);upstream.pipe(client);
  const close=()=>{client.destroy();upstream.destroy();connections.delete(client);connections.delete(upstream);};
  client.on('error',close);upstream.on('error',close);client.on('close',close);upstream.on('close',close);
});
server.on('error',e=>{console.error(e.message);process.exitCode=1;});
server.listen(0,host,()=>{
  const port=server.address().port;
  const state={url:`http://${host}:${port}`,host,port,target:'127.0.0.1:5179',pid:process.pid};
  writeFileSync('.local/tailnet.json',JSON.stringify(state,null,2)+'\n',{mode:0o600});
  console.log(state.url);
});
function stop(){for(const s of connections)s.destroy();server.close(()=>{try{unlinkSync('.local/tailnet.json')}catch{}process.exit(0);});}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
