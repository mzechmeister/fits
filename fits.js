async function gethdr(file, pos=0) {
    var hdu = {extstart: pos, file: file}
    var cards = []

    // read blockwise
    while (!cards.slice(-36).includes("END".padEnd(80, " "))) {
        if (file.size) {
            response = file.slice(pos, pos+2880)  // exclusive
        } else {
            response = await fetch(file, {headers: {Range: `bytes=${pos}-${pos+2880-1}`}});
            if (!response.ok) return null;
        }
        buf = await response.text()
        if (buf.length != 2880) return null;  // if range is ignored (e.g. python http.server)
        cards.push(...buf.match(/.{80}/g))
        pos += 2880
    }

    hdu.cards = cards
    hdu.ncards = cards.length
    hdu.hdr = hdr = cards2hdr(cards)
    hdu.bitpix = hdr['BITPIX']
    hdu.dim = [...Array(hdr.NAXIS).keys()].map(j => hdr['NAXIS'+(j+1)])
    hdu.datastart = pos
    hdu.hdrsize = hdu.datastart - hdu.extstart
    hdu.datasize = hdr.NAXIS && hdu.dim.reduce((a,b) => a*b, Math.abs(hdu.bitpix/8))
    hdu.dataend = hdu.datastart + hdu.datasize
    hdu.extend = Math.ceil(hdu.dataend/2880) * 2880   // pad size
    hdu.fileend = file.size || +response.headers.get("content-range").split('/')[1]
    hdu.last = hdu.extend == hdu.fileend
    hdu.extname = hdr['EXTNAME'] && hdr['EXTNAME'].trim()

    if (hdr['XTENSION'] == "BINTABLE") {
        hdu.TFIELDS = hdr['TFIELDS']
        offset = 0
        hdu.cols = []
        for (k=0; k++<hdu.TFIELDS;) {
            col = {k: k-1,
               name: hdr['TTYPE'+k].trim(),   // one-based indexing
               fmt: hdr['TINFO'+k],
               annot: hdr['TANNOT'+k],
               byteOffset: offset
            }
            col.byteSize = {"double": 8, "byte": 1}[col.fmt]
            hdu.cols.push(col)
            offset += col.byteSize
        }
        hdu.rowSize = offset
        hdu.dim = [hdu.TFIELDS, hdr['NAXIS2']]
        // https://archive.stsci.edu/fits/fits_standard/node68.html#SECTION001231020000000000000
    }

    return hdu
}

function cards2hdr(cards) {
    hdr = {}
    for (card of cards) {
        [key, val, comm] = card.split(/[=/]/);
        if (val) {
            val = val.trim()
            val = val.startsWith("'") ? val.slice(1,-1) :
                  val == "T" ? true :
                  val == "F" ? false : +val;
            hdr[key.trim()] = val
        }
    }
    return hdr
}

async function readfits(file) {
    hdulist = []
    hdu = {extend: 0}
    var k = 0
    while (!hdu.last) {
        hdulist.push(hdu = await gethdr(file, hdu.extend))
        hdu.extnum = k++
        if (hdu.extname) hdulist[hdu.extname] = hdu   // not looped in for-of
    }
    return hdulist
}

async function fitsdata(hdulist, ext=0) {
    hdu = hdulist[ext]
    if (!hdu.hdr.NAXIS) return null
    file = hdu.file

    var start = hdu.datastart
    var stop = hdu.dataend

    if (file.size) {
        var response = file.slice(start, stop)

    } else {
        var headers = {Range: `bytes=${start}-${stop-1}`};
        var response = await fetch(file, {headers: headers});
    }

    // swap endian
    buf = await response.arrayBuffer()

    if (hdu.cols) {
        // fits bintable
        view = new DataView(buf, 0)
        rowsize = hdu.rowSize
        d = {}
        for (col of hdu.cols) {
            getter = {"double": 'getFloat64', "byte": 'getInt8'}[col.fmt]
            dk = []
            for (i=col.byteOffset; i<hdu.datasize; i+=rowsize) {
                dk.push(view[getter](i))
            }
            d[col.name] = d[col.k] = dk
        }
        d.dim = hdu.dim
    } else {
        // fits image
        var b = {'32': 4, '-32': 4, '64': 8, '-64': 8}[hdu.bitpix]
        var NumberArray = {'32': Int32Array,
                       '-32': Float32Array,
                       '64': BigInt64Array,
                       '-64': Float64Array}[hdu.bitpix]
        d = new NumberArray(new Int8Array(buf.slice()).reverse().buffer).reverse()
        if (hdu.bitpix == 64) d = [...d].map(Number)   // convert BigInt64Array to array (to prevent: can't convert BigInt to number)
        d.dim = hdu.dim
    }
    return d
}
