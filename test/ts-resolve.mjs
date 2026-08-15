/* Lets tests import the API's TypeScript modules directly.
   The source uses NodeNext-style `./x.js` specifiers that resolve to `./x.ts`;
   Node's type-stripping doesn't do that remap, so we do it here. */
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && specifier.endsWith(".js") && context.parentURL) {
      const ts = specifier.replace(/\.js$/, ".ts");
      if (existsSync(fileURLToPath(new URL(ts, context.parentURL)))) {
        return next(ts, context);
      }
    }
    return next(specifier, context);
  },
});
