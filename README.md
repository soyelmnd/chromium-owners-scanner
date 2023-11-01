This is the very very early version of the OWNERS utils set that would be helpful for every repo using [Chromium's OWNERS files](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/code_reviews.md).  

Install it using either `npm`

```bash
npm i -g https://github.com/soyelmnd/chromium-owners-scanner
```

And then jump to the root of _your_ repo, run `goowners`. Might be best to pipe it through `less -r` or `>` to file since the output might be lengthy.    

```bash
goowners
```

(Or `yarn dlx -p chromium-owners-scanner@https://github.com/soyelmnd/chromium-owners-scanner goowners` without pre-installing if you prefer)

And :fingers_crossed: it will give you some statistics, e.g. file-owners map, number of owning files per owner, coownership stats, ownership coverage, etc

![image](https://github.com/soyelmnd/chromium-owners-scanner/assets/2678063/f30514da-9164-42a4-92b7-4a87a3467072)
