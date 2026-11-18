'use strict';
// Paper-only, quote-injected accounting. No signing, key loading, tx submission, or IO.
const SOL='So11111111111111111111111111111111111111112';
const USDC='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const isUsdc=p=>p.quoteMint===USDC;
const quoteMint=p=>p.quoteMint||SOL;
const quoteSymbol=p=>isUsdc(p)?'USDC':'SOL';
const quoteUsd=(p,px)=>isUsdc(p)?1:px;
const depositQuote=p=>p.depositQuote??p.depositSol;
const compoundedQuote=p=>p.feesCompoundedQuote??p.feesCompoundedSol??0;
function amounts(pos){let x=0,y=0;for(const b of Object.values(pos.bins||{})){x+=+b.x||0;y+=+b.y||0;}return {x,y};}
async function exitSolQuote({pos,book,snap,quote,txFee=.000025}){
 const px=+snap.pxUsd;if(!(px>0))throw Error('SOL/USD missing');const {x,y}=amounts(pos),token=x+(pos.feeX||0),qa=y+(pos.feeY||0),closeFees=3*txFee,refund=pos.rentRefundableSol||0;
 const native=(book.virtual.sol||0)+refund-closeFees;if(native<0)throw Error('Native close gas insufficient');
 const tr=Math.max(0,Math.min(.99,snap.estimatedTokenSwapFeeRate??((pos.baseFeePct??.3)/100))),sr=snap.estimatedSolSwapFeeRate??.0005,errors=[];
 const get=async(mint,amount,dec,mark,fee)=>{if(!(amount>0))return {out:0,cost:0,quoted:true};if(mint===SOL)return {out:amount,cost:0,quoted:true};let q;try{q=await quote(mint,SOL,BigInt(Math.floor(amount*10**dec)),dec,9);}catch(e){q={ok:false,error:String(e.message)};}if(q.ok&&Number.isFinite(q.outUi)&&q.outUi>=0)return {out:q.outUi,cost:Math.max(0,mark-q.outUi)*px,quoted:true};errors.push(q.error||'route unavailable');return {out:mark*(1-fee),cost:mark*fee*px,quoted:false};};
 const tokenSol=await get(pos.mintX,token,pos.decX,token*snap.price*(isUsdc(pos)?1/px:1),tr),ysol=await get(quoteMint(pos),qa,isUsdc(pos)?6:9,qa*(isUsdc(pos)?1/px:1),sr);
 // [F3-FAIL-CLOSED 2026-11-17] Valuasi KREDIT terpisah dari valuasi keputusan di atas:
 // kaki non-SOL yang gagal di-quote dikredit 0 (tanpa rute terverifikasi tidak ada bukti
 // kaki itu bisa dijual sama sekali); kaki SOL asli tidak butuh quote. Lihat exitQuote.
 const unquotedLegsSol=[];
 if(token>0&&!tokenSol.quoted)unquotedLegsSol.push('token');
 if(qa>0&&quoteMint(pos)!==SOL&&!ysol.quoted)unquotedLegsSol.push('quote');
 const creditSolOut=native+(tokenSol.quoted?tokenSol.out:0)+(ysol.quoted?ysol.out:0);
 const solOut=native+tokenSol.out+ysol.out,basis=pos.initialCapitalInSol||pos.capitalInSol,pnlCapital=solOut-pos.capitalInSol+(pos.realizedPnlCarrySol||0),pnlPct=basis>0?100*pnlCapital/basis:0,usdcOut=solOut*px,pnlUsd=usdcOut-pos.usdcIn+(pos.realizedPnlCarryUsd||0);
 return {solOut,usdcOut,pnlUsd,pnlPct,pnlCapital,pnlCapitalPct:pnlPct,capitalAsset:'SOL',positionValueUsd:(qa+token*snap.price)*quoteUsd(pos,px),x,y,tokenAmount:token,quoteAmount:qa,solPile:solOut,closeFees,rentBack:refund,tokenSwapCostUsd:tokenSol.cost,solSwapCostUsd:ysol.cost,estimatedTokenSwapFeeRate:tr,estimatedSolSwapFeeRate:sr,quoted:tokenSol.quoted&&ysol.quoted,unquotedClose:unquotedLegsSol.length>0,unquotedLegs:unquotedLegsSol,creditSolOut,creditPnlCapital:creditSolOut-pos.capitalInSol+(pos.realizedPnlCarrySol||0),quoteErrors:errors,valuationBasis:errors.length?'on-chain close-to-SOL estimate minus fees':'Jupiter token/USDC to SOL; native SOL retained',at:new Date().toISOString()};
}
async function exitQuote({pos,book,snap,quote,txFee=.000025}){
 if(pos.capitalAsset==='SOL')return exitSolQuote({pos,book,snap,quote,txFee});
 const px=+snap.pxUsd, unit=quoteUsd(pos,px);
 if(!(px>0))throw new Error('SOL/USD missing for paper exit');
 const {x,y}=amounts(pos),token=x+(pos.feeX||0),quoteAmount=y+(pos.feeY||0);
 const closeFees=3*txFee,refund=pos.rentRefundableSol||0;
 const solPile=(book.virtual.sol||0)+refund+(isUsdc(pos)?0:quoteAmount)-closeFees;
 if(solPile<0)throw new Error('paper close cannot cover native SOL fees');
 // Token mark comes from the on-chain active bin; only its estimated swap fee is
 // deducted. Native SOL conversion uses a separate low stable-route fee estimate.
 const tokenFeeRate=Math.max(0,Math.min(.99,snap.estimatedTokenSwapFeeRate??((pos.baseFeePct??.3)/100)));
 const solFeeRate=Math.max(0,Math.min(.99,snap.estimatedSolSwapFeeRate??.0005));
 // When Jupiter has no answer, value the token with the haircut seen on the LAST real quote (recent only) instead of the generic pool-fee guess (which was 1-3 points too pessimistic).
 const calib=(Number.isFinite(pos.lastTokenHaircut)&&Date.now()-Number(pos.lastQuoteAt||0)<30*60000)?Math.max(tokenFeeRate*.25,Math.min(.5,pos.lastTokenHaircut)):null;
 const tokenFallbackRate=calib??tokenFeeRate;
 const SOL_PILE_QUOTE_MIN_USD=30;   // a pile of a few SOL-cents is not worth a Jupiter call: estimated with the stable-route fee
 const UNQUOTED_SOL_HAIRCUT=0.01;   // [F3-FAIL-CLOSED 2026-11-17] quote SOL->USDC dicoba & gagal: tumpukan SOL dikredit pada mark x (1 - haircut tetap konservatif ini), bukan fee rute-stabil 0,05%. SOL likuid; kegagalan quote = gangguan API, bukan ilikuiditas; 1% = 20x fee rute-stabil sehingga tetap dapat dipertahankan sebagai batas konservatif.
 const errors=[];
 const get=async(mint,amount,dec,mark,feeRate)=>{
  if(!(amount>0))return {out:0,quoted:true,cost:0};
  const raw=BigInt(Math.max(0,Math.floor(amount*10**dec)));
  if(raw===0n)return {out:0,quoted:true,cost:mark};
  const q=await quote(mint,USDC,raw,dec,6);
  if(q.ok&&Number.isFinite(q.outUi)&&q.outUi>=0)return {out:q.outUi,quoted:true,cost:Math.max(0,mark-q.outUi),haircut:mark>0?Math.max(0,(mark-q.outUi)/mark):null};
  errors.push(q.error||'Jupiter route unavailable');
  return {out:mark*(1-feeRate),quoted:false,cost:mark*feeRate};
 };
 const tokenUsd=await get(pos.mintX,token,pos.decX,token*snap.price*unit,tokenFallbackRate);
 const solMark=Math.max(0,solPile)*px;
 const solUsd=solMark<SOL_PILE_QUOTE_MIN_USD?{out:solMark*(1-solFeeRate),quoted:false,estimated:true,cost:solMark*solFeeRate}:await get(SOL,Math.max(0,solPile),9,solMark,solFeeRate);
 const stable=isUsdc(pos)?quoteAmount:0;
 const usdcOut=stable+tokenUsd.out+solUsd.out;
 const pnlUsd=usdcOut-pos.usdcIn+(pos.realizedPnlCarryUsd||0),basis=pos.initialUsdcIn||pos.usdcIn,pnlPct=basis>0?100*pnlUsd/basis:0;
 // [F5 2026-11-17] Bendera quoted kaki tumpukan SOL kini jujur: kaki yang diestimasi
 // membawa quoted:false + estimated:true (bukan quoted:true). val.quoted di bawah
 // mempertahankan makna operasionalnya — semua kaki yang WAJIB di-quote terverifikasi —
 // sehingga kaki SOL estimasi-by-design (tumpukan kecil, aset likuid, fee rute-stabil)
 // tidak menggugurkan val.quoted; status estimasinya terlihat via solPileEstimated.
 const legsQuoted=tokenUsd.quoted&&(solUsd.estimated?true:solUsd.quoted);
 // [F3-FAIL-CLOSED 2026-11-17] Valuasi KREDIT terpisah dari valuasi keputusan:
 // usdcOut/pnlUsd di atas tetap basis keputusan/monitor (fallback mark, TIDAK berubah).
 // creditUsdcOut = satu-satunya yang boleh dikredit ke kas bila tutup benar-benar
 // dieksekusi tanpa quote terverifikasi (dipakai paperClose saat val.unquotedClose):
 // kaki token tanpa rute Jupiter = 0 (kasus rug: tidak ada bukti bisa dijual sama
 // sekali); kaki SOL yang quote-nya dicoba & gagal = mark x (1-UNQUOTED_SOL_HAIRCUT);
 // kaki terquote dan kaki estimasi-by-design memakai nilai keluarnya sendiri.
 const unquotedLegs=[];
 if(token>0&&!tokenUsd.quoted)unquotedLegs.push('token');
 if(solMark>0&&!solUsd.estimated&&!solUsd.quoted)unquotedLegs.push('sol-pile');
 const creditUsdcOut=stable+(tokenUsd.quoted?tokenUsd.out:0)+(solUsd.estimated||solUsd.quoted?solUsd.out:solMark*(1-UNQUOTED_SOL_HAIRCUT));
 return {usdcOut,pnlUsd,pnlPct,positionValueUsd:quoteAmount*unit+token*snap.price*unit,
  x,y,tokenAmount:token,quoteAmount,solPile,closeFees,rentBack:refund,
  tokenSwapCostUsd:tokenUsd.cost,solSwapCostUsd:solUsd.cost,
  estimatedTokenSwapFeeRate:tokenFeeRate,estimatedSolSwapFeeRate:solFeeRate,tokenFallbackRate,tokenHaircut:tokenUsd.quoted?(tokenUsd.haircut??null):null,solPileEstimated:!!solUsd.estimated,
  quoted:legsQuoted,unquotedClose:unquotedLegs.length>0,unquotedLegs,creditUsdcOut,creditPnlUsd:creditUsdcOut-pos.usdcIn+(pos.realizedPnlCarryUsd||0),quoteErrors:errors,
  valuationBasis:errors.length?'on-chain mark minus estimated swap fees (not eligible for TP)':'Jupiter close-to-USDC quote',at:new Date().toISOString()};
}
// All-quote initial shape is single-sided Y. USDC pool leaves Y as USDC; no unnecessary token swap.
async function planUsdcOpen({cash,existingSol=0,capUsd,gasBuffer=.3,rentRef=0,rentNon=0,openFees=0,solUsd,usdcBuffer=.1,quote}){
 if(!(solUsd>0)||!(cash>usdcBuffer))return {ok:false,why:'capital or SOL price missing'};
 const available=cash-usdcBuffer,need=Math.max(0,gasBuffer-existingSol);
 let gasUsdc=0,boughtSol=0;
 if(need>0){
  let spend=need*solUsd*1.01;
  for(let i=0;i<3;i++){
   if(spend>=available)return {ok:false,why:'USDC cannot cover native rent/gas buffer'};
   const q=await quote(USDC,SOL,BigInt(Math.ceil(spend*1e6)),6,9);
   if(!q.ok||!(q.outUi>0))return {ok:false,why:'Jupiter USDC->SOL buffer quote failed'};
   gasUsdc=q.inUi;boughtSol=q.outUi;
   if(boughtSol+1e-9>=need)break;
   spend*=need/boughtSol*1.005;
  }
  if(boughtSol+1e-9<need)return {ok:false,why:'buffer quote insufficient after bounded retries'};
 }
 const reserve=existingSol+boughtSol-rentRef-rentNon-openFees;
 if(reserve<3*.000025)return {ok:false,why:'native buffer cannot cover rent + open + close fees'};
 const deposit=Math.min(available-gasUsdc,capUsd>0?capUsd:0);
 if(!(deposit>1))return {ok:false,why:'USDC deposit too small'};
 const spent=deposit+gasUsdc,carry=existingSol*solUsd;
 return {ok:true,depositQuote:deposit,usdcSpent:spent,usdcIn:spent+carry,solCarryInUsd:carry,
  gasUsdc,boughtSol,reserve,openSwapCostUsd:Math.max(0,gasUsdc-boughtSol*solUsd),tokenSwapUsdc:0};
}
module.exports={SOL,USDC,isUsdc,quoteMint,quoteSymbol,quoteUsd,depositQuote,compoundedQuote,amounts,exitQuote,planUsdcOpen};
