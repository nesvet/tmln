import { resolve } from "node:path";
import { Conveyer, ESBuild } from "cnvr";


const { NODE_ENV } = process.env;

const distDir = "dist";


new Conveyer([
	
	new ESBuild({
		entryPoints: [ "src/index.ts" ],
		outfile: resolve(distDir, "index.js"),
		external: true,
		platform: "neutral",
		format: "esm",
		sourcemap: true,
		target: "es2020",
		define: {
			"process.env.NODE_ENV": JSON.stringify(NODE_ENV)
		}
	})
	
], {
	initialCleanup: distDir
});
