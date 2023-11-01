This is the very very early version of the OWNERS utils set that would be helpful for every repo using [Chromium's OWNERS files](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/code_reviews.md).  

Install it using either `npm` or `yarn`  

```bash
npm i -g https://github.com/soyelmnd/chromium-owners-scanner
```

And then jump to the root of _your_ repo, run `goowners`  

```bash
goowners
```

And :fingers_crossed: it will give you some statistics, e.g. file-owners map, number of owning files per owner, coownership stats, ownership coverage, etc