import {defineNitroPlugin} from "nitropack/runtime";
import {productionConfigErrors} from "../utils/site-config";

/**
 * 生产进程启动门禁：配置不完整时在监听业务流量前直接失败。
 */
export default defineNitroPlugin(() => {
    const errors = productionConfigErrors();
    if (errors.length > 0) {
        throw new Error(`生产配置无效：\n- ${errors.join("\n- ")}`);
    }
});
