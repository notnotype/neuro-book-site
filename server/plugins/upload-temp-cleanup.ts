import {defineNitroPlugin} from "nitropack/runtime";
import {cleanupUploadTempFiles} from "../utils/upload-temp-cleanup";

/** 进程启动时清理崩溃或中断上传遗留的过期 .part 文件。 */
export default defineNitroPlugin(async () => {
    await cleanupUploadTempFiles();
});
