var fs = require('fs'); // filesystem
var url = require('url'); // parse url
var stream = require('stream'); // gulp new files
var gulp = require('gulp'); // tasks
var gutil = require('gulp-util'); // File, console colors
var map = require('./vinyl-map'); // piping custom code
var del = require('del'); // clean folders
var gulpFilter = require('gulp-filter'); // pipe less files (testing)
var request = require('request'); // downloading assets
var j = request.jar(); // Cookie jar
request = request.defaults({
    jar: j,
    followRedirect: false,
    headers: {
        'Accept-Charset': 'utf-8;q=0.7,*;q=0.3'
    },
    encoding: null
});
var mime = require('mime-types'); // Get the default extension for a content-type
var jschardet = require('jschardet'); // detect charset
var iconv = require('iconv').Iconv; // convert charset
var iconvObj; // for iconv
var crypto = require('crypto'); // hash filename
var timethat = require('timethat'); // elapsed time
var logger = require('gulp-logger'); // what file in pipe right now
var jsdom = require("jsdom");  // browser window, dom, doc
var serializeDocument = require("jsdom").serializeDocument;
var jquery = require("jquery"); // selectors and dom manipulation




/*
    User Variables
*/

var base = url.parse('http://joyreactor.cc/');

// FOR AUTH LOOK FOR do_auth()

// big file test
// var base = url.parse('http://releases.ubuntu.com/14.04.1/ubuntu-14.04.1-desktop-amd64.iso');

// test no server
// var base = url.parse('http://thissitedoesnotwork.com/');


var PATHS = {
    html: { 
        raw: './raw/',
        src: './raw/*.html',
        raw2: './raw2/'
    },
    cache: '_cache.json'
};

// jquery selectors
var scopes = {
    'main': '#Pagination a',
    // 'threads': '#ipbwrapper .tableborder tr td:nth-child(3) a',
};

var guide = [
    {
        name: 'index', // label for this guide
        page: /^http:\/\/joyreactor.cc\/$/, // regex match current page
        scope: scopes.main, // jQuery Selector looking for links
        // filter: /showforum/ // regex filter found links
    },
    {
        name: 'sub pages',
        page: /^http:\/\/joyreactor.cc\/\d*(\,|\.)?\d+$/,
        scope: scopes.main,
        // filter: /showforum/
    }
];


/*
    Working vars
*/

var start = new Date();
var cache = {};

var totalSize = 0; // Bytes

var stats = {
    madeRequests: 0,
    code200: 0,
    requestNot200: 0,
    downloadError: 0,
    skipDuplicates: 0,
    filesCount: 0,
    fileWrite: 0,
    fileWriteErr: 0,

    pageOneSkips: 0,

    // DOM manipulation
    links: 0,
    
    html_files: 0,
};

var guide_stats = {};

for(var i in guide){
    guide_stats[ guide[i].name ] = 0;
};


var pool = [];
var concurrency = 0;
var requests_active = 0;
var auth_active = 0;
var pause_sometimes = true;
var pool_pause = pause_sometimes; // used with auth
var concurrency_lim = 32; // 32
var d_bytes = 0;
var d_bytes_last = 0;
var d_time = process.hrtime();


/**
 *  Helper functions
 */

var cleanMatch = function(url_str) {
    var firstChar;
    url_str = url_str.trim();
    firstChar = url_str.substr(0, 1);
    if (firstChar === (url_str.substr(-1)) && (firstChar === '"' || firstChar === "'")) {
      url_str = url_str.substr(1, url_str.length - 2);
    }
    return url_str;
};

var isRelativeUrl = function(parts) {
    return !parts.protocol && !parts.host;
};

var isRelativeToBase = function(url_str) {
    return '/' === url_str.substr(0, 1);
};

function prettyBytes(num) {
    if (typeof num !== 'number' || (num !== num)) {
        throw new TypeError('Expected a number');
    }
    if(num == 0) return '0 Byte';
    var neg = num < 0;
    if(neg) num = -num;
    if(num < 1) return (neg ? '-' : '') + num + ' B';
    var k = 1000;
    var sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    var i = Math.floor(Math.log(num) / Math.log(k));
    // console.log( num, k, i );
    return (neg ? '-' : '') + (num / Math.pow(k, i)).toPrecision(3) + ' ' + sizes[i];
}

function elapsed() {
    
    console.log('Elapsed: ', timethat.calc(start, new Date()),
        '| RAM:', prettyBytes( process.memoryUsage().heapUsed ),
        '| concurrency:', concurrency,
        '| pool:', pool.length
    );
}

function stats_log() {

    console.log("");
    console.log("");

    for(var stat in stats){
        console.log('# '+stat+': ', stats[stat]);
    }
    for(var _guide in guide_stats){
        console.log('$ '+_guide+': ', guide_stats[_guide]);
    }

    elapsed();

    var hrTime = process.hrtime(d_time);
    d_time = process.hrtime();
    var d_speed = (d_bytes - d_bytes_last) / ( hrTime[0] + hrTime[1] / 1e9 );
    d_bytes_last = d_bytes;

    console.log("Requests active: ", requests_active,
        "| Downloaded: ", prettyBytes( totalSize ),
        "| ~", prettyBytes( d_speed )+'/sec'
    );

    console.log("");
}

function onEnd() {

    stats_log();
}

// var Intervals = {};
// function gc_start() {
//     Intervals.gc_j = setInterval(function () {
//         // 200000000 = 200MB
//         if (process.memoryUsage().heapUsed > 400000000) { 
//             console.log('###  gc  ###');
//             console.log('###  gc  ###');
//             console.log('###  gc  ###');
//             global.gc();
//         }
//     }, 5000);
// }



try {

    cache = JSON.parse(fs.readFileSync(PATHS.cache));
    
    for(var k in cache){
        if( 'c' in cache[k] ){
            cache[k].c = 0;
        }
    }

} catch (err) {
    if (err.code !== 'ENOENT'){ // file not found
        if(! (err instanceof SyntaxError)){ // JSON.parse error
            throw err;
        }
    } 
}



gulp.task('default', [], function(cb) {

    
    function workWithLoot(href, response, extension) {

        // console.log( '# workWithLoot', href, extension );
        
        stats.filesCount++;


        if( extension == 'html' ){


            var document = jsdom.jsdom(response.body);
            var window = document.parentWindow;
            var $ = jquery(window);


            //
            // The Guide bit

            for( var t in guide ){

                if( guide[t].page.test( href ) ){

                    // console.log( '>> matched guide: ', guide[t].name );
                    // console.log( 'guide[t].scope', guide[t].scope);

                    var goodLinks = 0;
                    var $links = $(guide[t].scope)
                    .each(function(index, a) {

                        if( !this.hasAttribute('href') ) return;
                        
                        //! cleanMatch

                        var _href = url.parse( $(a).attr('href') || '', true );

                        if( isRelativeUrl( _href ) ){

                            _href = url.parse( url.resolve(base.href, _href.href), true );
                        }
                        
                        if( _href.host == base.host ){

                            // filter out some links
                            if( ( guide[t].filter !== void 0 )
                                && ( ! guide[t].filter.test( _href.href ) ) ){

                                return;
                            }

                            // skip page 1
                            // if( _href.query && _href.query.st && _href.query.st == 0 ){
                            //     return;
                            // }
                            
                            if( pushToQueue(_href.href) ){

                                goodLinks++;
                                guide_stats[ guide[t].name ] ++;
                            }
                        }
                    });

                    // console.log( 'found links: ', $links.length );
                    // console.log( 'good links: ', goodLinks );
                }
            }


            //
            // The Dom manipulation bit


            // fix links
            // $('a').each(function(){
                
            //     if( !this.hasAttribute('href') ) return;

            //     var link = this.getAttribute('href');
                

            //     stats.links++;

            //     var a_href = url.parse( link, true );

            //     if( a_href.query && a_href.query.st && a_href.query.st == 0 ){
            //         delete a_href.search;
            //         delete a_href.query.st;
            //         // console.log( a_href );
            //         link = url.format( a_href );
            //         // console.log( link );
            //     }

            //     this.setAttribute('href', link);

            //     // var div = document.createElement('div');
            //     // div.appendChild(this);

            //     // console.log( div.innerHTML );
            // });
            // window.$('.main1').find('img').attr('src');
            // console.log( Object.keys(links).length );



            // remove meta
            $('meta').first().remove(); 

            // remove option tags
            $('option').remove();

            // remove script tags
            $('script').remove();

            // remove html comments
            $("*").contents().filter(function(){
                return this.nodeType == 8;
            }).remove();


            // work with assets
            $('img').each(function(){

                if( !this.hasAttribute('src') ) return;

                var link = url.parse( cleanMatch( this.getAttribute('src') ), false, true);

                if( isRelativeUrl(link) ){

                    link = url.parse( url.resolve(base.href, link.href), true );
                } 

                if( link.host == base.host ){

                    pushToQueue(link.href);
                }

                // console.log( 'img link:', link.href );
            });

            // var html = window.document.documentElement.outerHTML;
        
            response.body = serializeDocument(document);

            // remove whitespace
            response.body = response.body.replace(/(\r\n|\n|\r|\s+)/gm, " ");

            // close jsDom and free memory.
            $( document ).ready(function() {
                window.close();
            });

            stats.html_files++;
        }


        var body = response.body;

        var filename = crypto.createHash('md5').update(href).digest('hex');
        // console.log(hash); // 9b74c9897bac770ffc029102a200c5de
        filename += '.' + extension;


        var checksum = crypto.createHash('md5').update(body).digest('hex');


        // fs.writeFile(PATHS.html.raw + filename, body, function(err) {
        //     if(err) {
        //         stats.fileWriteErr++;
        //         console.log(err);
        //     } else {
        //         stats.fileWrite++;
        //         // console.log("The file was saved!");

        //         if( !cache[href] ){
        //             cache[href] = {};
        //         }
        //         cache[href].alt = filename;
        //     }
        // }); 

        
        if( href in cache && 'alt' in cache[href] && cache[href].alt == filename ){

            if( 'checksum' in cache[href] && checksum == cache[href].checksum ){

                // console.log( 'same file exactly!');
                concurrency--;
                return;
            }
        }

        //! errors? success? make this simpler?

        var src = stream.Readable({ objectMode: true });
        src._read = function () {
            this.push(new gutil.File({ 
                cwd: "", base: "", 
                path: filename, 
                contents: new Buffer(body) 
                // contents: new Buffer(body, 'binary') 
            }))
            this.push(null)
        }
        src.pipe(gulp.dest(PATHS.html.raw)) // './raw/'
        .on('end', function () {

            // console.log( 'dest end' );
            
            stats.fileWrite++;
            if( !cache[href] ){
                cache[href] = {};
            }
            cache[href].alt = filename;
            cache[href].extension = extension;
            cache[href].checksum = checksum;
        });

        concurrency--;
    };
    

    function makeRequest(href) {

        // limiter...
        // if( stats.html_files > 30 ){
        //     concurrency--;
        //     return; 
        // }

        requests_active++;
        stats.madeRequests++;

        var data_length = 0;
        
        var req = request({url:href, jar: j}, function (error, response, body) {
            
            requests_active--;
        
            //! cache count download errors/redirects. skip this href on threshold
            //! also for review on download complete, task "retry"

            if( error ){

                gutil.log(gutil.colors.red('Download error:'), error );
                console.log( href );
                stats.downloadError++;
                concurrency--;
                return;
            }

            // console.log( '<< Request Callback: ' + this.href + ' ['+response.statusCode+']' );

            if( response.statusCode == 400 ){

                stats.request400++;
                console.log('###   400   ###');
                process.exit();
            }

            if (response.statusCode == 200) {
                    
                stats.code200++;

                var extension = mime.extension( response.headers['content-type'] );

                if( extension == 'html' ){

                    var detected = jschardet.detect(response.body);

                    if (detected && detected.encoding) {
                            
                        // console.log(
                        //         'Detected charset ' + detected.encoding +
                        //         ' (' + Math.floor(detected.confidence * 100) + '% confidence)'
                        // );
                
                        if (detected.encoding !== 'utf-8' && detected.encoding !== 'ascii') {

                                iconvObj = new iconv(detected.encoding, 'UTF-8//TRANSLIT//IGNORE');
                                response.body = iconvObj.convert(response.body).toString();

                        } else if (typeof response.body !== 'string') {
                                response.body = response.body.toString();
                        }

                    } else {
                        response.body = response.body.toString('utf8');
                    }
                }

                totalSize += response.body.toString().length;

                workWithLoot( this.href, response, extension );

            } else { // not 200
             
                gutil.log(gutil.colors.red('statusCode:'), statusCode );
                
                stats.requestNot200++;
                concurrency--;
                //! log href + response statusCode
            }

        }).on('data', function(chunk) {

            // decompressed chunk as it is received
            // console.log('chunk: ' + chunk.length, ' data_length: ', data_length);

            data_length += chunk.length;
            d_bytes += chunk.length;

            if (data_length > 10000000) {

                gutil.log( gutil.colors.red('file too big') );
                req.abort(); //! this.abort() ?
                concurrency--;
                requests_active--;
            }
        });
    };

    function pushToQueue(href) {

        if( href in cache ){

            if( 'c' in cache[href] && cache[href].c >= 1 ){

                cache[href].c++;
                stats.skipDuplicates++;
                return false;
            }
        
        } else {
            cache[href] = {};
        }

        cache[href].c = 1;

        pool.push( function () {
            
            if( 'alt' in cache[href] ){

                fs.readFile(PATHS.html.raw + cache[href].alt, function(err, data) {
                    
                    if (err){
                        console.log( gutil.colors.red(err) );

                        makeRequest(href);

                        return;
                    }

                    //! extension undefined?

                    workWithLoot( href, { body: data, fromFile: true }, cache[href].extension );

                });

                return;
            }

            makeRequest(href);
        });

        return true;
    };

    function do_auth(callback) {
        
        if( auth_active ) return;
        console.log('# do_auth()');

        auth_active = true;

        j = request.jar(); // new jar

        var login_url = 'http://joyreactor.cc/login';

        var req = request({url:login_url, jar: j}, function (error, response, body) {
                
            console.log('auth get:', response.statusCode);

            if( error ){
                gutil.log(gutil.colors.red('Download error:'), error );
                process.exit();
            }

            if (response.statusCode == 401 ) { //! weird website uses code 401

                var document = jsdom.jsdom(response.body);
                var window = document.parentWindow;
                var $ = jquery(window);

                var csrf_token = $('#signin__csrf_token').val();

                console.log( 'csrf_token', csrf_token );

                $( document ).ready(function() {
                    window.close();
                });

                request.post({url:login_url, jar: j,
                        form:{
                            signin: {
                                username: 'testytesty',
                                password: 'testy@yopmail.com',
                                remember: 'on',
                                _csrf_token: csrf_token,
                            }
                        }
                    }, 
                    function (err, response, body) {
                        
                        console.log('auth post:', response.statusCode);

                        if (err) {
                            console.log('error');
                            console.error('failed:', err);
                            process.exit();
                        }

                        auth_active = false;

                        callback( err, response, body );
                    }
                    
                ).on('end', function () { // response, error, data
                    
                    // auth_active = false;
                    // console.log( '$$ Auth end' );
                });
            }
        });
    };
    



    // Start

    pushToQueue( base.href );



    var pooler = setInterval(function () {

        if( concurrency <= concurrency_lim && pool.length > 0 && !pool_pause ){

            var dispense = concurrency_lim - concurrency;

            while( dispense > 0 ){

                if( pool.length == 0 ) return;
                setTimeout(pool.shift(), 100);
                concurrency++;
                dispense--;
            }
        }

    }, 3000);

    function cache_save() {
        
        console.log('# saving data to files');

        var str = JSON.stringify(cache, null, 4) + '\n';

        fs.writeFileSync(PATHS.cache, str);
    }

    var cacher = setInterval(cache_save, 60000);

    var pauser = setInterval(function () {

        if( pause_sometimes )
            pool_pause = true;

    }, 60000);

    var logger = setInterval(stats_log, 2033);

    var idle_count = 0;

    var auther = setInterval(function () {
        
        if( pool_pause == true && requests_active == 0 ){

            do_auth(function () {
                
                pool_pause = false;

                console.log('# Authenticated!');

            });
        }
        
        if( pool_pause == false && requests_active == 0 && concurrency == 0 ){
            idle_count++;
            console.log('idle:', idle_count);
        } else {
            idle_count = 0;
        }

        if( idle_count > 5 ){

            clearInterval(pooler);
            clearInterval(pauser);
            clearInterval(auther);
            clearInterval(logger);
            clearInterval(cacher);

            stats_log();
            cache_save();
            
            cb(); // finished task

            gulp.start('links:update');
        }

    }, 3000);

});


gulp.task('links:update', [], function() {

    // cache = JSON.parse(fs.readFileSync(PATHS.cache));

    var cache_keys = Object.keys(cache);

    function escapeRegExp(str) {
        return (str+'').replace(/[.?*+^$[\]\\(){}|-]/g, "\\$&");
        // return string.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1");
    }

    var esc_cache = {};

    var working_links = {};


    for(var k in cache_keys){

        if( 'alt' in cache[ cache_keys[k] ] ){

            var key = "('|\")"+ escapeRegExp(cache_keys[k]) +"('|\")";
            esc_cache[key] = k;

            working_links[ cache_keys[k] ] = cache[ cache_keys[k] ];

        }

        // cache_keys[k] = "('|\")"+ escapeRegExp(cache_keys[k]) +"('|\")";
    }

    // console.log( working_links );
    // console.log( Object.keys(working_links).length );
    // console.log( 'esc_cache: ', Object.keys(esc_cache).length  ); // 7214
    // console.log( 'esc_links: ', Object.keys(esc_links).length  ); // 1132
    // console.log(  Object.keys(esc_links).join("|")  );

    var re_cache = new RegExp(Object.keys(esc_cache).join("|"),"gi");
    

  return gulp.src([PATHS.html.src])

    .pipe(logger())
    .pipe(map(function(contents, filename) {
        
        concurrency++;
        elapsed();
        
        contents = contents.toString();


        // css
        // contents = contents.replace(re_links, function(matched){
            
        //     // console.log( matched );

        //     if(!( matched in links )){

        //         gutil.log(gutil.colors.red('Match not in links!'));
        //         return matched;
        //     }
        //     return links[matched].alt || matched;
        // });

        // if( filename.indexOf('style.css') >= 0 )
        //     return contents;


        // html
        // contents = contents.replace(re_cache, function(matched){
            
        //     var k = matched.slice(1, -1);                
        //     // console.log( k );
        //     if(!( k in cache )){
        //         gutil.log(gutil.colors.red('Match not in cache!'));
        //         return matched;
        //     }

        //     return cache[k].alt || matched;
        // });


        var doc = jsdom.jsdom(contents);
        var window = doc.parentWindow;
        var $ = jquery(window);


        $('link, a').each(function(){
            
            if( !this.hasAttribute('href') ) return;

            var link = this.getAttribute('href');

            var _link = url.parse( link, true );

            if( isRelativeUrl( _link ) ){

                _link = url.parse( url.resolve(base.href, _link.href), true );
            }


            // var link = url.parse( cleanMatch( this.getAttribute('src') ), false, true);

            // if( isRelativeUrl(link) ){

            //     link = url.parse( url.resolve(base.href, link.href), true );
            // }

            
            if( _link.href in working_links ){

                // console.log( link );
                link = working_links[_link.href].alt;
                this.setAttribute('href', link);
            }

            // console.log( div.innerHTML );
        });
        // console.log( Object.keys(links).length );


        var html = serializeDocument(doc);
             
        $( doc ).ready(function() {
            window.close();
        });

        return html;
    }))
    .pipe(gulp.dest(PATHS.html.raw2))
    .pipe(map(function(contents, filename) {
        
        concurrency--;
        console.log('DEST. c: ', concurrency);
        
    }))
    .on('end', onEnd);

});


/*

https://github.com/substack/stream-handbook

https://www.npmjs.com/package/chalk


npm install streamqueue --save-dev --no-bin-links

gulp --expose_gc


links serialization fixed (tag attr):
jsdom 1.5.0, parse5, serialization\serializer.js:144


Tips and Tricks for Faster Front-End Builds
http://io.pellucid.com/blog/tips-and-tricks-for-faster-front-end-builds


#spider
https://github.com/sylvinus/node-crawler/blob/master/lib/crawler.js

#node url
http://nodejs.org/docs/latest/api/url.html#url_url_parse_urlstr_parsequerystring_slashesdenotehost

#pool
https://github.com/coopernurse/node-pool


*/
