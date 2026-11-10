// script.js：DXFの読み込み、描画、画像変換、保存を担当します。
/*
  ここからアプリ本体。
  (() => { ... })() は「即時実行関数」。この中で使う変数を外へ漏らさないための囲い。
  "use strict" は、JavaScriptの曖昧な書き方をエラーにしやすくする安全設定。
*/
(() => {
  "use strict";

  // HTML要素をidで取得するための短縮関数。$("status") は document.getElementById("status") と同じ。
  const $ = id => document.getElementById(id);

  // 画面で何度も使う要素は、最初に取得して変数へ入れておく。
  const drop = $("drop"), fileInput = $("file"), preview = $("preview");
  const pctx = preview.getContext("2d"); // canvasに図形を描くための2D描画機能を取得。

  // アプリが保持する状態。
  // parsed：DXFを解析した結果。filename：保存ファイル名の元。
  let parsed = null, filename = "drawing", lastBlob = null;

  // 画面左下のステータス欄へメッセージを表示する。
  function say(message) { $("status").textContent = message; }

  // 選択された用紙サイズと縦横方向から、用紙幅w・高さh（mm）を返す。
  // 用紙サイズの選択肢は「幅,高さ」の文字列で保持している。
  function paperSize() {
    let [w,h] = $("paper").value.split(",").map(Number);
    if ($("orientation").value === "portrait") [w,h] = [h,w];
    return {w,h};
  }
  // プレビュー上部に、切り出し寸法と解像度を表示する。
  function setPreviewMeta(w,h,dpi) {
    $("previewMeta").textContent = `${w} × ${h} mm ・ ${dpi} dpi`;
  }
  // 図形の色を決める。
  // DXFのACI色番号のうち基本色だけを簡易対応している。
  // 本格対応では、レイヤー色（BYLAYER）やブロック色（BYBLOCK）も参照する必要がある。
  function layerColor(entity) {
    // ACI色番号の基本色を近似。BYLAYER(256)・BYBLOCK(0)は黒扱い。
    const colors = {1:"#ff0000",2:"#ffff00",3:"#00aa00",4:"#00aaaa",5:"#0000ff",6:"#aa00aa",7:"#111111",8:"#777777",9:"#aaaaaa"};
    return colors[entity.color] || "#111111";
  }
  // DXF内の図形を1個ずつcanvasへ描く関数。
  // ctx：描画先canvasの2Dコンテキスト
  // e：描画対象のDXF図形（entity）
  // tr：図面座標を画像上のピクセル座標へ変換する情報
  function drawEntity(ctx, e, tr) {
    // 座標変換。Xは右向き、Yは上向きのDXF座標を、Yが下向きのcanvas座標へ変換する。
    // tr.h-y とすることで上下が反転する。tr.sはmmからpixelへの倍率。
    const p = (x,y) => [tr.x + x*tr.s, tr.y + (tr.h-y)*tr.s];
    // 線幅を設定。拡大率に応じて太くするが、画面上で細すぎないよう最小0.7pxにする。
    const lineWidth = Math.max(0.7, tr.s * 0.18);
    ctx.strokeStyle = layerColor(e); ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = lineWidth; ctx.lineCap = "round"; ctx.lineJoin = "round";
    // DXF図形の種類を大文字に統一し、種類ごとの描画処理へ振り分ける。
    const type = String(e.type || "").toUpperCase();
    ctx.beginPath();
    // 直線：始点と終点をcanvas座標へ変換して線を引く。
    if (type === "LINE") {
      const a=p(e.vertices?.[0]?.x ?? e.start?.x, e.vertices?.[0]?.y ?? e.start?.y);
      const b=p(e.vertices?.[1]?.x ?? e.end?.x, e.vertices?.[1]?.y ?? e.end?.y);
      if (a.some(Number.isNaN)||b.some(Number.isNaN)) return;
      ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
    // 円：中心座標と半径を使って円周を描く。
    } else if (type === "CIRCLE") {
      const c=e.center; if(!c) return;
      const q=p(c.x,c.y); ctx.arc(q[0],q[1],Math.abs(e.radius*tr.s),0,Math.PI*2); ctx.stroke();
    // 円弧：中心・半径・開始角・終了角から円弧を描く。
    } else if (type === "ARC") {
      const c=e.center; if(!c) return;
      const q=p(c.x,c.y), a0=(e.startAngle||0), a1=(e.endAngle||0);
      // DXF角度は反時計回り。CanvasはY反転済みなので符号を反転する。
      ctx.arc(q[0],q[1],Math.abs(e.radius*tr.s),-a0,-a1,true); ctx.stroke();
    // ポリライン：複数の頂点を順番につなぐ。closed/shapeなら最後と最初もつなぐ。
    } else if (type === "LWPOLYLINE" || type === "POLYLINE") {
      const verts=e.vertices || []; if(verts.length<2) return;
      verts.forEach((v,i)=>{ const q=p(v.x,v.y); if(i===0)ctx.moveTo(...q); else ctx.lineTo(...q); });
      if(e.shape || e.closed) ctx.closePath();
      ctx.stroke();
    // 点：小さな四角形で位置を表示する。
    } else if (type === "POINT") {
      const q=p(e.position?.x,e.position?.y); ctx.fillRect(q[0]-2,q[1]-2,4,4);
    // 文字：挿入位置と文字高さを使って描画する。
    // MTEXTの段落・書式などは簡略化しており、完全な再現ではない。
    } else if (type === "TEXT" || type === "MTEXT") {
      const pos=e.startPoint || e.position || e.insertionPoint; if(!pos) return;
      const q=p(pos.x,pos.y);
      const h=Math.max(5,(e.textHeight || e.height || 2.5)*tr.s);
      ctx.save(); ctx.translate(q[0],q[1]); ctx.scale(1,-1);
      ctx.font=`${h}px sans-serif`; ctx.fillText(String(e.text||"").replace(/\\P/g,"\n"),0,0); ctx.restore();
    // 塗りつぶし領域系：頂点をつないで輪郭線を描く（このサンプルでは塗りつぶさない）。
    } else if (type === "SOLID" || type === "3DFACE") {
      const verts=e.vertices||[]; if(verts.length<3)return;
      verts.forEach((v,i)=>{const q=p(v.x,v.y);if(i===0)ctx.moveTo(...q);else ctx.lineTo(...q);});
      ctx.closePath();ctx.stroke();
    }
    // その他のエンティティはこのサンプルではスキップ。
  }
  // 図面を「指定した用紙範囲」で画像化する中心処理。
  // プレビューと保存画像の両方がこの関数を使うため、切り出し条件が共通になる。
  // maxPixels：保存画像の画素数上限。forPreview=trueなら画面表示用に縮小する。
  function renderToCanvas(canvas, maxPixels, forPreview=false) {
    if(!parsed) throw new Error("DXFが読み込まれていません。");
    // 用紙寸法（mm）を取得。切り出し範囲は常に原点から X=0..w、Y=0..h。
    const {w,h}=paperSize();
    let dpi=Number($("dpi").value);
    let pxW=Math.round(w/25.4*dpi), pxH=Math.round(h/25.4*dpi);
    // プレビューは画面に収まるサイズへ縮小する。保存時は選択DPIどおりの画素数を使う。
    if(forPreview) {
      const scale=Math.min(1100/pxW,760/pxH,1);
      pxW=Math.max(1,Math.round(pxW*scale)); pxH=Math.max(1,Math.round(pxH*scale));
    } else if(pxW*pxH>maxPixels) {
      throw new Error("出力画像が大きすぎます。DPIを下げるか、小さい用紙を選択してください。");
    }
    // canvas自体のピクセル寸法を設定。ここで実際の出力解像度が決まる。
    canvas.width=pxW; canvas.height=pxH;
    const ctx=canvas.getContext("2d",{willReadFrequently:true});
    ctx.fillStyle="#ffffff";ctx.fillRect(0,0,pxW,pxH);
    const sx=pxW/w, sy=pxH/h;
    // 図面座標(mm)を用紙ピクセルへ変換。モデル空間単位はmmを想定。
    // 原点を画像左下に対応させ、用紙外の図形はcanvasのクリップ範囲で見えなくする。
    const tr={x:0,y:0,h:h,s:sx};
    ctx.save(); ctx.beginPath();ctx.rect(0,0,pxW,pxH);ctx.clip();
    // DXFに含まれる全図形を順番に描画する。
    // ここでは図形を事前に削除せず、用紙サイズのcanvasからはみ出した部分をクリップしている。
    for(const e of (parsed.entities||[])) drawEntity(ctx,e,tr);
    ctx.restore();
    return {pxW,pxH,w,h,dpi};
  }
  // ファイル選択・ドラッグ＆ドロップのどちらからも呼ばれるDXF読み込み処理。
  // FileReaderでファイル内容を文字列として読み、dxf-parserで解析する。
  function loadFile(file) {
    if(!file) return;
    if(!/\.dxf$/i.test(file.name)) { say("DXFファイルを選択してください。"); return; }
    if(typeof DxfParser === "undefined") { say("DXF解析ライブラリを読み込めません。インターネット接続を確認してください。"); return; }
    say(`読み込み中: ${file.name}`);
    const reader=new FileReader();
    reader.onerror=()=>say("ファイルを読み込めませんでした。");
    // ファイル読み込み完了後に実行される処理。解析成功時はプレビューまで更新する。
    reader.onload=()=>{
      try {
        const parser=new DxfParser();
        parsed=parser.parseSync(String(reader.result));
        filename=file.name.replace(/\.dxf$/i,"");
        $("render").disabled=false;
        $("download").disabled=false;
        const count=parsed.entities?.length||0;
        say(`${file.name} を読み込みました。エンティティ数: ${count}`);
        updatePreview();
      } catch(err) {
        parsed=null;$("render").disabled=true;$("download").disabled=true;
        say("DXF解析エラー: "+(err.message||err));
      }
    };
    reader.readAsText(file);
  }
  // 現在の用紙・向き・DPI設定でプレビューを描き直す。
  // 設定変更時と「プレビュー更新」ボタンから呼ばれる。
  function updatePreview() {
    try {
      const result=renderToCanvas(preview,Infinity,true);
      setPreviewMeta(result.w,result.h,Number($("dpi").value));
      $("download").disabled=false;
    } catch(err) { say(err.message||String(err)); }
  }
  // canvasの画素データをTIFFファイルへ変換する。
  // TIFFライブラリを使わず、非圧縮・RGB・8bitのBaseline TIFFを組み立てている。
  // そのためファイルサイズは大きくなるが、構造は比較的単純。
  function encodeTiff(canvas) {
    // Baseline TIFF, little-endian, uncompressed, 8-bit RGB, one strip.
    const ctx=canvas.getContext("2d",{willReadFrequently:true});
    // canvasからRGBA（赤・緑・青・透明度）の画素配列を取得する。
    const {data}=ctx.getImageData(0,0,canvas.width,canvas.height);
    const width=canvas.width,height=canvas.height, samples=3;
    const rgb=new Uint8Array(width*height*samples);
    for(let s=0,d=0;s<data.length;s+=4){rgb[d++]=data[s];rgb[d++]=data[s+1];rgb[d++]=data[s+2];}
    // TIFFのヘッダーとタグ情報（IFD）を配置する位置を計算する。
    // TIFFは画像データだけでなく、幅・高さ・色数・解像度などのタグを持つ。
    const entries=11, ifdOffset=8, ifdSize=2+entries*12+4;
    const bitsOffset=ifdOffset+ifdSize, xresOffset=bitsOffset+6, yresOffset=xresOffset+8, pixelOffset=yresOffset+8;
    const total=pixelOffset+rgb.length;
    const buffer=new ArrayBuffer(total), view=new DataView(buffer), bytes=new Uint8Array(buffer);
    view.setUint16(0,0x4949,true);view.setUint16(2,42,true);view.setUint32(4,ifdOffset,true);
    view.setUint16(ifdOffset,entries,true);
    let o=ifdOffset+2;
    // TIFFタグを1件書き込む小さな補助関数。
    // trueはリトルエンディアン（下位バイトから並べる形式）を意味する。
    function tag(id,type,count,value){view.setUint16(o,id,true);view.setUint16(o+2,type,true);view.setUint32(o+4,count,true);view.setUint32(o+8,value,true);o+=12;}
    tag(256,4,1,width); tag(257,4,1,height); tag(258,3,3,bitsOffset);
    tag(259,3,1,1); tag(262,3,1,2); tag(273,4,1,pixelOffset);
    tag(277,3,1,3); tag(278,4,1,height); tag(279,4,1,rgb.length);
    tag(282,5,1,xresOffset); tag(283,5,1,yresOffset);
    view.setUint32(o,0,true);
    view.setUint16(bitsOffset,8,true);view.setUint16(bitsOffset+2,8,true);view.setUint16(bitsOffset+4,8,true);
    const dpi=Number($("dpi").value);
    view.setUint32(xresOffset,dpi,true);view.setUint32(xresOffset+4,1,true);
    view.setUint32(yresOffset,dpi,true);view.setUint32(yresOffset+4,1,true);
    bytes.set(rgb,pixelOffset);
    return new Blob([buffer],{type:"image/tiff"});
  }
  // 「画像を保存」ボタンの処理。
  // 用紙とDPIから本番サイズのcanvasを作り、TIFFまたはPNGとしてダウンロードする。
  function download() {
    if(!parsed)return;
    try {
      const {w,h}=paperSize(),dpi=Number($("dpi").value);
      const out=document.createElement("canvas");
      const result=renderToCanvas(out,30000000,false);
      const isTiff=$("format").value==="tiff";
      // TIFFは上の自作エンコーダーでBlob化。PNGはブラウザー標準機能でBlob化する。
      const blob=isTiff?encodeTiff(out):null;
      if(isTiff) saveBlob(blob,`${filename}_${w}x${h}mm_${dpi}dpi.tif`);
      else out.toBlob(b=>{if(b)saveBlob(b,`${filename}_${w}x${h}mm_${dpi}dpi.png`);},"image/png");
      say(`出力しました: ${result.pxW} × ${result.pxH} px`);
    } catch(err) { say("出力エラー: "+(err.message||err)); }
  }
  // Blob（画像データ）をブラウザーからファイル保存させる共通処理。
  // 一時URLを作ってダウンロードリンクをクリックし、少し待ってからURLを破棄する。
  function saveBlob(blob,name) {
    const url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
  }
  // ここから画面操作と関数を結び付けるイベント設定。
  // ドロップ領域のクリック／Enter／Spaceでファイル選択ダイアログを開く。
  drop.addEventListener("click",()=>fileInput.click());
  drop.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();fileInput.click();}});
  // ファイル選択ダイアログでファイルが選ばれたら読み込む。
  fileInput.addEventListener("change",e=>loadFile(e.target.files[0]));
  ["dragenter","dragover"].forEach(type=>drop.addEventListener(type,e=>{e.preventDefault();drop.classList.add("over");}));
  ["dragleave","drop"].forEach(type=>drop.addEventListener(type,e=>{e.preventDefault();drop.classList.remove("over");}));
  // ファイルがドロップされたら、そのファイルを読み込む。
  drop.addEventListener("drop",e=>loadFile(e.dataTransfer.files[0]));
  $("render").addEventListener("click",updatePreview);
  $("fit").addEventListener("click",updatePreview);
  $("download").addEventListener("click",download);
  // 用紙サイズ・縦横・DPIが変更されたら、即座にプレビューを描き直す。
  // 出力形式（TIFF/PNG）は画像の見た目を変えないため、プレビュー更新の対象外。
  ["paper","orientation","dpi"].forEach(id=>$(id).addEventListener("change",updatePreview));
})();
