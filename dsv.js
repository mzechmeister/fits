document.write('<script src="fits.js"></script>');

async function dsv(file, ...args) {
    if (typeof file == "string") {
        filename = file;
        // nothing needed if file is instanceof File
        [file, ext] = file.split(/[\[\]]/)
        var hdulist = await fitsopen(file);
    }
    else {
       hdulist = file
       ext = hdulist.ext
       filename = hdulist.file.name
    }
 
    var responseText = await fitsdata(hdulist, ext)
    if (!file.ok) console.log(file.statusText, "("+file.url+")")
    if (responseText[0]) {
        responseText.__proto__._url = filename //|| file.url
        text_to_table(responseText, ...args)
    }
}

function auto_colnames(data) {
    // check for a header row (no numbers) and convert it to column names
    colnames = data.map(d => d.name)
    data._colnames = colnames
    data.unshift([...Array(data[0].length).keys()])  // prepend a column 0 with row numbers
    console.log(colnames)
}

function text_to_table(dataorg, func, delim) {
    data = dataorg   // global variable
    auto_colnames(data)
    data._basename = data._url.split('/').pop()
    func(data)
}
