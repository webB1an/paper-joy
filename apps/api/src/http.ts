export function configureProxy(app:{set:(name:string,value:unknown)=>unknown}) {
 // Only the loopback Nginx hop is trusted. Express stops at the first external hop.
 app.set('trust proxy','loopback');
}
