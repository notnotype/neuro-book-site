import type {WorkshopMetaDto} from "../../../shared/dto/workshop.dto";
import pkg from "../../../package.json";

/**
 * 平台元信息：客户端握手 / 探活用，无需账号。
 */
export default defineEventHandler((): WorkshopMetaDto => {
    return {
        platform: "neuro-book-site",
        platformVersion: pkg.version,
        apiVersion: 1,
        manifestVersion: 1,
        itemTypes: ["skill", "profile"],
    };
});
