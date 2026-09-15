import { writeFileSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const root=process.cwd(), dir='/tmp/idosi-revenue-browser'
mkdirSync(dir,{recursive:true})
const { createIdosiServer }=await import(pathToFileURL(resolve(root,'server/vps/server.mjs')))
const base='http://127.0.0.1:4187'
const bootstrapToken=randomUUID(), warehouseKey=`isolated-${randomUUID()}`, password=`Preview-${randomUUID()}`
const {server}=createIdosiServer({databasePath:`${dir}/preview.sqlite`,imagesDirectory:`${dir}/images`,migrationsDirectory:resolve(root,'drizzle'),staticDirectory:resolve(root,'dist/client'),bootstrapToken,warehouseApiKey:warehouseKey,requestLogger:null,automaticRevenueBonusEnabled:false})
await new Promise(resolve=>server.listen(4187,'127.0.0.1',resolve))
const request=async(path,body,headers={})=>{
 const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)})
 const value=await r.json(); if(!r.ok) throw Error(JSON.stringify(value));return value
}
const date=new Date(Date.now()+7*3600_000).toISOString().slice(0,10), at=`${date}T07:00:00+07:00`
const items=[{productId:'order-product-001',productName:'Đồ nam',quantity:2,unitPrice:50000,revenueType:'NORMAL'},{productId:'order-product-001',productName:'Đồ nam',quantity:2.5,unitPrice:20000,revenueType:'SALE_KG',unit:'KG'},{productId:'order-product-002',productName:'Đầm',quantity:3,unitPrice:10000,revenueType:'SALE_PIECE'}]
await request('/api/bootstrap',{username:'admin.preview',password,initialState:{
 stores:[{id:'S01',short:'DEMO',name:'IDOSI • Cửa hàng minh họa',status:'Đang hoạt động'},{id:'S02',short:'OTHER',name:'Cửa hàng khác',status:'Đang hoạt động'}],
 employees:[{id:'E01',code:'E01',name:'Nhân viên minh họa',storeId:'S01',unit:'store',status:'Đang làm việc'},{id:'E02',code:'E02',name:'Nhân viên khác',storeId:'S01',unit:'store',status:'Đang làm việc'},{id:'M01',code:'M01',name:'Quản lý minh họa',storeId:'S01',unit:'store_manager',status:'Đang làm việc'}],
 shiftDefinitions:[{id:'AM',storeId:'S01',name:'Ca sáng',start:'07:00',end:'18:00',active:true}],
 attendance:[{id:'ATT1',employeeId:'E01',storeId:'S01',date,shiftId:'AM',shift:'AM',shiftName:'Ca sáng',shiftStart:'07:00',shiftEnd:'18:00',checkIn:'07:00',checkInAt:at}],
 orders:[{id:'OWN',code:'DEMO-00000',storeId:'S01',employeeId:'E01',createdByEmployeeId:'E01',employeeName:'Nhân viên minh họa',attendanceId:'ATT1',shiftId:'AM',shiftName:'Ca sáng',shiftStart:'07:00',shiftEnd:'18:00',createdAt:at,amount:180000,paymentMethod:'Tiền mặt',status:'Hoàn tất',customerName:'Khách minh họa',gender:'Nữ',occupation:'Kỹ sư',acquisitionChannel:'Facebook',items},
 {id:'COLLEAGUE-SECRET',code:'BOB-SECRET',storeId:'S01',employeeId:'E02',createdByEmployeeId:'E02',employeeName:'Nhân viên khác',shiftId:'AM',shiftName:'Ca sáng',createdAt:at,amount:100000,paymentMethod:'Chuyển khoản',status:'Hoàn tất',items:[{productId:'order-product-001',productName:'Đồ nam',quantity:2}]},
 {id:'FOREIGN-SECRET',storeId:'S02',employeeId:'E03',createdAt:at,amount:999999,paymentMethod:'Tiền mặt'}],
 payrollPeriods:[],orderAudit:[]
}},{'x-idosi-bootstrap-token':bootstrapToken})
const admin=await request('/api/login',{username:'admin.preview',password})
for(const [username,employeeId,role] of [['employee.preview','E01','employee'],['manager.preview','M01','store_manager']]){
 await request('/api/command',{type:'user.create',payload:{username,password,displayName:role==='employee'?'Nhân viên minh họa':'Quản lý minh họa',employeeId,role,storeId:'S01'}},{authorization:`Bearer ${admin.token}`,'idempotency-key':randomUUID()})
}
writeFileSync(`${dir}/access.json`,JSON.stringify({base,password,date,warehouseKey}),{mode:0o600})
console.log('ISOLATED_PREVIEW_READY')
