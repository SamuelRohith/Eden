import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const files=['server.mjs','azure-functions.mjs'];
for(const dir of ['server','dist','scripts','tests']) {
  for(const file of await readdir(new URL(`../${dir}/`,import.meta.url)))if(/\.(mjs|js)$/.test(file))files.push(`${dir}/${file}`);
}
for(const file of files) {
  const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit',windowsHide:true});
  if(result.status!==0)process.exit(result.status||1);
}
console.log(`Syntax checks passed for ${files.length} JavaScript files.`);
