import * as pattern from "./pattern";
import * as utils from "./utils";

export const foobar = () => pattern.match("foo", "bar");
export const foobaz = () =>
  utils.getSignature({ of: "this" }, { and: "this" }).then(console.log);

foobaz();
