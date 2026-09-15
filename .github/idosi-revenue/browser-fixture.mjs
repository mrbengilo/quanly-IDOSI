import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
const load = (path) => import(pathToFileURL(join(process.cwd(), path)).href)
const { createIdosiServer } = await load('server/vps/server.mjs')
const { DEFAULT_ORDER_INFORMATION_OPTIONS } = await load('src/domain/orderInformationSettings.js')
const { orderBusinessDate } = await load('src/domain/orderSummary.js')
const date = orderBusinessDate({ createdAt: new Date().toISOString() })
const [year, month] = date.split('-').map(Number)
const historicalDate = new Date(Date.UTC(year, month - 2, 6)).toISOString().slice(0, 10)
const historicalBase = { storeId: 'S1', employeeId: 'E2', createdByEmployeeId: 'E2', createdBy: { role: 'employee', employeeId: 'E2' }, customerName: 'Khách kiểm thử ca lịch sử', paymentMethod: 'Tiền mặt', createdAt: `${historicalDate}T18:00:00+07:00`, status: 'Hoàn tất' }
const historicalOrders = [
 { ...historicalBase, id: 'HISTORY-AM', code: 'TEST-HISTORY-AM', shiftId: 'RETIRED-AM', shiftName: 'Ca sáng', shiftStart: '08:00', shiftEnd: '12:00', amount: 43000 },
 { ...historicalBase, id: 'HISTORY-PM', code: 'TEST-HISTORY-PM', shiftName: 'Ca tối', shiftStart: '17:00', shiftEnd: '22:00', amount: 180000, normalAmount: 100000, items: [
  { productId: 'order-product-001', productName: 'Đồ nam', quantity: 2 },
  { productId: 'order-product-001', productName: 'Đồ nam', revenueType: 'SALE_KG', quantity: 2.5, unitPrice: 20000 },
  { productId: 'order-product-001', productName: 'Đồ nam', revenueType: 'SALE_PIECE', quantity: 3, unitPrice: 10000 },
 ] },
 { ...historicalBase, id: 'HISTORY-UNBOUND', code: 'TEST-HISTORY-UNBOUND', amount: 17000 },
]
const root = process.env.RUNNER_TEMP || '/tmp'
const { server } = createIdosiServer({ databasePath:join(root,'revenue-browser/state.sqlite'), imagesDirectory:join(root,'revenue-browser/images'), bootstrapToken:'browser-fixture',warehouseApiKey:'synthetic-warehouse-browser-testing-key',warehouseApiStoreIds:'S1',automaticRevenueBonusEnabled:false })
await new Promise(done => server.listen(4040, '127.0.0.1', done))
const post=async (path,body,headers={}) => {
 const response=await fetch('http://127.0.0.1:4040'+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)})
 const result=await response.json(); if(!response.ok)throw new Error(JSON.stringify(result));return result
}
await post('/api/bootstrap',{username:'test.admin',password:'Synthetic-password-2026',initialState:{
 stores:[{id:'S1',code:'DS01',name:'IDOSI - Cửa hàng thử nghiệm',short:'DS01'}],
 employees:[{id:'M1',code:'QL001',name:'Quản lý thử nghiệm',storeId:'S1',unit:'store_manager',status:'Đang làm việc'},{id:'E1',code:'NV001',name:'Nhân viên thử nghiệm',storeId:'S1',unit:'store',status:'Đang làm việc'},{id:'E2',code:'NV002',name:'Nhân viên khác',storeId:'S1',unit:'store',status:'Đang làm việc'}],
 orderInformationOptions:DEFAULT_ORDER_INFORMATION_OPTIONS,
 shiftDefinitions:[{id:'AM',storeId:'S1',name:'Ca sáng',start:'08:00',end:'12:00',active:true},{id:'PM',storeId:'S1',name:'Ca chiều',start:'13:00',end:'17:00',active:true},{id:'EVENING',storeId:'S1',name:'Ca tối',start:'17:00',end:'22:00',active:true}],
 attendance:[{id:'AE1',employeeId:'E1',storeId:'S1',date,workDate:date,shiftId:'AM',shiftName:'Ca sáng',shiftStart:'08:00',shiftEnd:'12:00',checkIn:'08:00',checkInAt:`${date}T01:00:00Z`,checklistSnapshot:{source:'work-catalog',storeChecklistRepairVersion:1,tasks:[]}}],
 orders:[{id:'PEER',code:'DS01-PEER',storeId:'S1',employeeId:'E2',createdByEmployeeId:'E2',createdBy:{role:'employee',employeeId:'E2'},customerName:'Không được hiển thị cho E1',amount:700000,items:[{productId:'order-product-001',productName:'Đồ nam',quantity:10}],paymentMethod:'Tiền mặt',shiftId:'PM',shiftName:'Ca chiều',createdAt:`${date}T06:00:00Z`,status:'Hoàn tất'}, ...historicalOrders]
}}, {'x-idosi-bootstrap-token':'browser-fixture'})
const admin=await post('/api/login',{username:'test.admin',password:'Synthetic-password-2026'})
for(const [username,role,employeeId] of [['test.employee','employee','E1'],['test.store','store_manager','M1']]){
 await post('/api/command',{type:'user.create',payload:{username,password:'Synthetic-password-2026',displayName:role,role,storeId:'S1',employeeId}}, {authorization:`Bearer ${admin.token}`,'idempotency-key':username})
}
await writeFile(join(root,'revenue-evidence/shift-history-fixture.json'), JSON.stringify({ date: historicalDate, storeId: 'S1', total: 240000 }))
console.log('BROWSER_FIXTURE_READY')
