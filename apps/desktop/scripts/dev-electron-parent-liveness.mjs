import * as NodeFS from "node:fs";

/**
 * Watches the pipe owned by dev-runner. A closed pipe means the runner exited,
 * including when it was hard-killed, so the supervisor can shut down its app.
 */
export function watchParentLiveness({ fd = 3, onParentExit }) {
  try {
    const stream = NodeFS.createReadStream(null, { fd, autoClose: true });
    let exited = false;
    const parentExited = () => {
      if (exited) return;
      exited = true;
      onParentExit();
    };
    stream.once("end", parentExited);
    stream.once("close", parentExited);
    stream.once("error", parentExited);
    stream.resume();
    return stream;
  } catch {
    onParentExit();
    return null;
  }
}
