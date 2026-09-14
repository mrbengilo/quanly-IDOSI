import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
const load = (path) => import(pathToFileURL(join(process.cwd(), path)).href)
const { createIdosiServer } = await load('server/vps/server.mjs')
const { DEFAULT_ORDER_INFORMATION_OPTIONS } = await load('src/domain/orderInformationSettings.js')
const { orderBusinessDate } = await load('src/domain/orderSummary.js')
const date = orderBusinessDate({ createdAt: new Date().toISOString() })
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
 shiftDefinitions:[{id:'AM',storeId:'S1',name:'Ca sáng',start:'08:00',end:'12:00',active:true},{id:'PM',storeId:'S1',name:'Ca chiều',start:'13:00',end:'17:00',active:true}],
 attendance:[{id:'AE1',employeeId:'E1',storeId:'S1',date,workDate:date,shiftId:'AM',shiftName:'Ca sáng',shiftStart:'08:00',shiftEnd:'12:00',checkIn:'08:00',checkInAt:`${date}T01:00:00Z`,checklistSnapshot:{source:'work-catalog',storeChecklistRepairVersion:1,tasks:[]}}],
 orders:[{id:'PEER',code:'DS01-PEER',storeId:'S1',employeeId:'E2',createdByEmployeeId:'E2',createdBy:{role:'employee',employeeId:'E2'},customerName:'Không được hiển thị cho E1',amount:700000,items:[{productId:'order-product-001',productName:'Đồ nam',quantity:10}],paymentMethod:'Tiền mặt',shiftId:'PM',shiftName:'Ca chiều',createdAt:`${date}T06:00:00Z`,status:'Hoàn tất'}]
}}, {'x-idosi-bootstrap-token':'browser-fixture'})
const admin=await post('/api/login',{username:'test.admin',password:'Synthetic-password-2026'})
for(const [username,role,employeeId] of [['test.employee','employee','E1'],['test.store','store_manager','M1']]){
 await post('/api/command',{type:'user.create',payload:{username,password:'Synthetic-password-2026',displayName:role,role,storeId:'S1',employeeId}}, {authorization:`Bearer ${admin.token}`,'idempotency-key':username})
}
console.log('BROWSER_FIXTURE_READY')
