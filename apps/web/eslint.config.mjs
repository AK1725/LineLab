import nextVitals from "eslint-config-next/core-web-vitals";
import base from "../../eslint.config.js";

// Next's rules first, then the shared config, so the typescript-eslint parser (with type
// information) wins over eslint-config-next's parser and `disableTypeChecked` still applies to JS.
const config = [...nextVitals, ...base];

export default config;
