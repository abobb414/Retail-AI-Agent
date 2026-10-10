import { handleImageRequest } from '../utils/imageProxy'

// Nitro 按方法后缀注册路由：只有 image.get.ts 时 HEAD 直接 404，所以单独注册一份。
export default defineEventHandler((event) => handleImageRequest(event, 'HEAD'))
