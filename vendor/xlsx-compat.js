/** Lightweight offline XLSX adapter for the existing student import/export workflows.
 * Supports standard Office Open XML .xlsx worksheets, first-row headers and exports.
 * Legacy .xls binary files use optional SheetJS CDN fallback. */
(function(global){'use strict';
  const encoder = new TextEncoder(); const decoder = new TextDecoder();
  function findFiles(bytes){
    const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    let eocd=-1; for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){if(dv.getUint32(i,true)===0x06054b50){eocd=i;break;}}
    if(eocd<0)throw new Error('不是有效的 .xlsx 文件，旧版 .xls 请联网使用完整 Excel 组件');
    let at=dv.getUint32(eocd+16,true),n=dv.getUint16(eocd+10,true);const files={};
    for(let i=0;i<n;i++){
      if(dv.getUint32(at,true)!==0x02014b50)throw new Error('Excel 文件目录损坏');
      const method=dv.getUint16(at+10,true),length=dv.getUint32(at+20,true),nameLen=dv.getUint16(at+28,true),extraLen=dv.getUint16(at+30,true),commentLen=dv.getUint16(at+32,true),offset=dv.getUint32(at+42,true);
      const name=decoder.decode(bytes.subarray(at+46,at+46+nameLen));
      if(name.endsWith('.xml')||name.endsWith('.rels')){
        const start=offset+30+dv.getUint16(offset+26,true)+dv.getUint16(offset+28,true),chunk=bytes.subarray(start,start+length);
        files[name]=method===8 ? decoder.decode(global.pako.inflateRaw(chunk)) : method===0 ? decoder.decode(chunk) : '';
      }
      at+=46+nameLen+extraLen+commentLen;
    }
    return files;
  }
  const parseXML = content => new DOMParser().parseFromString(content,'application/xml');
  const localName = node => node.localName || node.nodeName.replace(/^.*:/,'');
  function children(el,name){return Array.from(el.getElementsByTagName('*')).filter(x=>localName(x)===name);}
  function columnIndex(name){let index=0;for(const c of name){index=index*26+c.charCodeAt(0)-64;}return index-1;}
  function read(array){
    const bytes=array instanceof Uint8Array ? array : new Uint8Array(array);const files=findFiles(bytes);
    const strings=[];
    if(files['xl/sharedStrings.xml']){
      const doc=parseXML(files['xl/sharedStrings.xml']);
      for(const cell of children(doc,'si')) strings.push(children(cell,'t').map(x=>x.textContent).join(''));
    }
    const sheetPaths=Object.keys(files).filter(x=>/^xl\/worksheets\/sheet\d+\.xml$/.test(x)).sort((a,b)=>Number(a.match(/sheet(\d+)/)[1])-Number(b.match(/sheet(\d+)/)[1]));
    if(!sheetPaths.length)throw new Error('Excel 文件中未找到工作表');
    const sheets={};const names=[];
    sheetPaths.forEach((path,i)=>{
      const doc=parseXML(files[path]),rows=[];
      for(const row of children(doc,'row')){
        const r=Number(row.getAttribute('r'))||rows.length+1,cols=[];
        for(const cell of children(row,'c')){
          const ref=cell.getAttribute('r')||'',column=ref.match(/^[A-Z]+/)?.[0],idx=column?columnIndex(column):cols.length,t=cell.getAttribute('t');
          const value=children(cell,'v')[0]?.textContent||'';
          let parsed=t==='s'?strings[Number(value)]||'':t==='inlineStr'?children(cell,'t').map(x=>x.textContent).join(''):t==='b'?(value==='1'):t==='n'||t==null?(value===''?'':Number(value)):value;
          cols[idx]=parsed;
        }
        rows[r-1]=cols;
      }
      const name='Sheet'+(i+1);sheets[name]={__rows:rows};names.push(name);
    });
    return {Sheets:sheets,SheetNames:names};
  }
  function sheet_to_json(sheet){const rows=sheet.__rows||[],heading=(rows.find(x=>x?.length)||[]).map(v=>String(v??''));let first=rows.findIndex(x=>x?.length);if(first<0)return [];
    return rows.slice(first+1).filter(r=>r?.some(v=>v!==undefined && String(v).trim()!=='')).map(r=>{const out={};heading.forEach((key,i)=>{if(key)out[key]=r?.[i]??'';});return out;});
  }
  function json_to_sheet(rows){const keys=Object.keys(rows[0]||{});return {__rows:[keys,...rows.map(row=>keys.map(key=>row[key]??''))]};}
  function escapeXML(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}
  function colName(index){let s='';for(let n=index+1;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
  /* Standards-complete OOXML export for Office/WPS/WeChat document previews.
   * Shared strings, styles, document properties, relationships, dimensions,
   * column widths and text cell types are required by stricter viewers. */
  function sharedStringXML(values,total){return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="'+total+'" uniqueCount="'+values.length+'">'+values.map(v=>'<si><t xml:space="preserve">'+escapeXML(v)+'</t></si>').join('')+'</sst>';}
  function workbookXML(sheets){return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>'+sheets.map((s,i)=>`<sheet name="${escapeXML(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')+'</sheets><calcPr calcId="191029"/></workbook>';}
  const stylesXML='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="0"/><fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Microsoft YaHei"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2666C3"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFDCE6F1"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  function sheetXML(sheet,pool,strings){
    const rows=sheet.__rows||[],cols=Math.max(1,...rows.map(r=>r?.length||0));
    const widths=Array.from({length:cols},(_,i)=>Math.min(38,Math.max(13,...rows.slice(0,100).map(r=>Math.min(38,Array.from(String(r?.[i]??'')).reduce((n,ch)=>n+(/[^\u0000-\u007f]/.test(ch)?2:1),0)+3)))));
    const first=rows[0]||[];
    const body=rows.map((row,r)=>`<row r="${r+1}" ht="${r===0?27:21}" customHeight="1">`+(row||[]).map((v,c)=>{
      if(v==null)return '';
      const ref=colName(c)+(r+1),isText=r===0||/学号|姓名|日期|时间|最近提交|编号|账号/.test(String(first[c]||''));
      if(!isText&&typeof v==='number'&&Number.isFinite(v))return `<c r="${ref}" s="0"><v>${v}</v></c>`;
      const value=String(v),id=pool.has(value)?pool.get(value):strings.push(value)-1;
      pool.set(value,id);return `<c r="${ref}" s="${r===0?1:2}" t="s"><v>${id}</v></c>`;
    }).join('')+'</row>').join('');
    const range='A1:'+colName(cols-1)+Math.max(1,rows.length);
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="'+range+'"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="21"/><cols>'+widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')+'</cols><sheetData>'+body+'</sheetData><autoFilter ref="'+range+'"/><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>';
  }
  function book_new(){return {SheetNames:[],Sheets:{}};}
  function book_append_sheet(book,sheet,name){const safe=String(name||'Sheet').slice(0,31).replace(/[\\/?*\[\]:]/g,'_');book.SheetNames.push(safe);book.Sheets[safe]=sheet;}
  async function writeFile(book,fileName){
    const names=book.SheetNames;if(!names.length)throw new Error('没有可导出的工作表');
    const zip=new global.JSZip();const pool=new Map(),strings=[];
    const contentTypes='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'+names.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')+'</Types>';
    zip.file('[Content_Types].xml',contentTypes);
    zip.file('_rels/.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>');
    zip.file('xl/workbook.xml',workbookXML(names.map(name=>({name}))));
    zip.file('xl/_rels/workbook.xml.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+names.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')+`<Relationship Id="rId${names.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${names.length+2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`);
    names.forEach((name,i)=>zip.file(`xl/worksheets/sheet${i+1}.xml`,sheetXML(book.Sheets[name],pool,strings)));
    zip.file('xl/styles.xml',stylesXML);
    zip.file('xl/sharedStrings.xml',sharedStringXML(strings,Array.from(pool.values()).length));
    const now=new Date().toISOString();
    zip.file('docProps/core.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>学分服务中心</dc:creator><cp:lastModifiedBy>学分服务中心</cp:lastModifiedBy><dcterms:modified xsi:type="dcterms:W3CDTF">'+now+'</dcterms:modified></cp:coreProperties>');
    zip.file('docProps/app.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Microsoft Office Excel</Application><DocSecurity>0</DocSecurity><AppVersion>16.0300</AppVersion></Properties>');
    const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=fileName||'export.xlsx';link.style.display='none';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);
    return blob;
  }
  global.XLSX={read,writeFile,utils:{sheet_to_json,json_to_sheet,book_new,book_append_sheet}};
})(window);
