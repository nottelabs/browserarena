import test from "node:test";
import assert from "node:assert/strict";
import { accessMediaOrigin } from "./website-access-media";
test("media stays unpublished unless explicitly configured",()=>assert.equal(accessMediaOrigin(undefined),null));
test("public bucket prefix supports same-origin media delivery",()=>assert.equal(accessMediaOrigin("https://cdn.example.com/access/"),"https://cdn.example.com/access"));
test("credentials and signed download URLs cannot become public rewrite destinations",()=>{
  for(const url of ["http://cdn.example.com","https://user:secret@cdn.example.com","https://cdn.example.com?token=secret","https://cdn.example.com#fragment"]){assert.throws(()=>accessMediaOrigin(url));}
});
