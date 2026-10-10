import { handleImageRequest } from '../utils/imageProxy'

export default defineEventHandler((event) => handleImageRequest(event, 'GET'))
