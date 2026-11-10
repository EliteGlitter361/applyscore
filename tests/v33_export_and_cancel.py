"""v3.3 submission Excel export and upload cancellation with Vue feedback."""
from v32_admin_vue import open_admin
from pathlib import Path
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 p,errors=open_admin(browser,390)
 p.locator('.admin-mobile-tab-select select').select_option('files')
 p.get_by_role('button',name='提交状态',exact=False).first.click()
 p.locator('#submissionModal').get_by_text('李同学').wait_for(timeout=12000)
 p.evaluate('''() => {window.__exports=[];window.XLSX={utils:{json_to_sheet:arr=>({rows:arr}),book_new:()=>({sheets:[]}),book_append_sheet:(wb,ws,name)=>wb.sheets.push({name,rows:ws.rows})},writeFile:async(wb,file)=>{window.__exports.push({file,wb})}}}''')
 p.locator('#submissionModal').get_by_role('button',name='导出 Excel').click()
 p.wait_for_function('window.__exports.length===1')
 assert p.evaluate('window.__exports[0].wb.sheets[0].rows[0]["学号"]')=='0001'
 p.locator('#submissionModal').get_by_role('button',name='未交 (1)').click()
 p.locator('#submissionModal').get_by_role('button',name='导出 Excel').click()
 p.wait_for_function('window.__exports.length===2')
 assert p.evaluate('window.__exports[1].file.startsWith("未交名单_")')
 assert not errors,errors
 print('PASS Vue XLSX export (submitted/non-submitted, text ID)')
 p.close();browser.close()
