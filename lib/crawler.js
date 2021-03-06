
const { URL } = require('url');

const { partial, isFunction } = require('lodash');
const fetch = require('node-fetch');
const cheerio = require('cheerio');

const URL_IN_CSS_REGEX = /url\(['"]?(.*?)['"]?\)/gim;
const URL_IN_CSS_GROUP = 1;

/**
 * @param {String} url
 * @param {{js?: Boolean, css?:Boolean, images?:Boolean}} [options]
 * @param {(name, data)} callback
 */
module.exports = async function (url, options, callback) {
    // Note!!! - in order to use function's 'arguments' this function SHOULD NOT be arrow-function,
    // otherwise 'arguments' will be simply a reference to the 'arguments' of the enclosing scope
    if (arguments.length === 2) {
        const temp = options;
        options = null;
        callback = temp;
    }
    if (!isFunction(callback))
        throw new Error('No callback provided');

    // merge with default properties
    options = {
        js: true,
        css: true,
        images: true,
        ...options
    };

    // let it be real URL
    url = new URL(url);

    console.log(`Start crawling ${url.href}`);

    const html = await fetch(url).then(res => res.text());

    callback(new URL('index.html', url).pathname.substr(1), html);

    const $ = cheerio.load(html);

    const checkUrl = partial(crawl, url);

    const crawlPromises = [];

    if (options.css) {
        /**
         * 
         * @param {{url: String, data: Buffer}} css 
         */
        const crawlCSS = ({ url, data }) => {
            const crawlCssPromises = [];
            let match;
            while ((match = URL_IN_CSS_REGEX.exec(data)) !== null) {
                let urlMatched = match[URL_IN_CSS_GROUP];

                // skip inline images like "data:image/svg+xml;...."
                // skip external links http/https
                if (urlMatched.startsWith('data:') || urlMatched.startsWith('http')) {
                    continue;
                }

                // remove the hash and query params
                urlMatched = urlMatched.split('?')[0];
                urlMatched = urlMatched.split('#')[0];

                const crawlCssPromise = crawl(url, urlMatched, callback)
                    .then(crawlCSS)
                    .catch(console.error);
                crawlCssPromises.push(crawlCssPromise);
            }
            return Promise.all(crawlCssPromises);
        };

        $('link[rel="stylesheet"]').each((_index, el) => {
            const href = $(el).attr('href');
            const crawlPromise = checkUrl(href, callback)
                // Crawl each CSS file as it can be:
                // css/plugins.css
                // @import url("plugins/bootstrap.min.css");
                // @import url("plugins/animate.min.css");
                // body { background-image: url(img/bg.png); }
                // ......
                // Note the base url has to be updated here - real files to crawl will be:
                // css/plugins/bootstrap.min.css, css/plugins/animate.min.css, ....
                .then(crawlCSS)
                .catch(console.error);
            crawlPromises.push(crawlPromise);
        });
    }

    if (options.js) {
        $('script').each((_index, el) => {
            const src = $(el).attr('src');
            const crawlPromise = checkUrl(src, callback)
                .catch(console.error);
            crawlPromises.push(crawlPromise);
        });
    }

    if (options.images) {
        $('img').each((_index, el) => {
            const src = $(el).attr('src');
            const crawlPromise = checkUrl(src, callback)
                .catch(console.error);
            crawlPromises.push(crawlPromise);
        });
    }

    // Return a resolved promise when all is really crawled
    return Promise.all(crawlPromises).then(() => console.log(`Finished crawling ${url.href}`));
};

/**
 * 
 * @param {String|URL} base 
 * @param {String} input 
 * @param {(name, data)} callback 
 */
const crawl = async (base, input, callback) => {
    if (!input)
        return Promise.reject('Skip empty');

    // console.log(`Checking ${input}`);

    const url = new URL(input, base);
    // only interested in resources form the same origin - not from the net
    if (url.origin === base.origin) {
        console.log(`Fetching ${url.href}`);
        return fetch(url)
            .then(res => {
                if (!res.ok) return Promise.reject(`Missing ${url.href}`);
                return res;
            })
            .then(res => res.buffer())
            .then(data => {
                console.log(`Fetched ${url.href}`);
                // remove the starting '/' , e.g. from '/xxx/yyy.js' return just 'xxx/yyy.js'
                const pathname = url.pathname.substr(1);
                callback(pathname, data);
                return { url, data };
            });
    }
    return Promise.reject(`Skip ${url.href}`);
};