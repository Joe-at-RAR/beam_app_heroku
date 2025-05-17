// import { Router } from 'express';
// import multer from 'multer';
// import path from 'path';
// import fs from 'fs';
// import * as patientService from '../services/patientService';
// import { documentService } from '../services/documentService';
// import { io } from '../socket';
// import config from '../config';
// import { DocumentType, MedicalDocument } from '@shared/types';
// import * as fileService from '../services/fileService';

// const router: Router = Router();

// // Helper function to truncate objects for logging
// const truncateForLogging = (obj: any, maxLength: number = 100): any => {
//   if (typeof obj === 'string') {
//     return obj.length > maxLength ? `${obj.substring(0, maxLength)}...` : obj;
//   }
//   if (Array.isArray(obj)) {
//     return obj.length > 10 ? `[${obj.length} items, showing first 3]: ${JSON.stringify(obj.slice(0, 3))}...` : obj;
//   }
//   if (typeof obj === 'object' && obj !== null) {
//     const truncated: any = {};
//     Object.entries(obj).forEach(([key, value]) => {
//       if (key === 'buffer' || key === 'data' || key === 'content') {
//         truncated[key] = '[Content truncated for logging]';
//       } else {
//         truncated[key] = truncateForLogging(value, maxLength);
//       }
//     });
//     return truncated;
//   }
//   return obj;
// };

// const storage = multer.diskStorage({
//   destination: (req, _file, cb) => {
//     const silknotePatientUuid = req.params['silknotePatientUuid'];
//     // Use the configured output directory
//     const dest = path.join(config.processing.outputDir, silknotePatientUuid);
//     fs.mkdirSync(dest, { recursive: true });
//     cb(null, dest);
//   },
//   filename: (_req, file, cb) => {
//     const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
//     cb(null, uniqueSuffix + '-' + file.originalname);
//   }
// });

// const upload = multer({ storage });

// router.post('/patients/:silknotePatientUuid/files', upload.array('files'), async (req, res) => {
//   const silknotePatientUuid = req.params['silknotePatientUuid'];
//   const timestamp = new Date().toISOString();
//   const requestId = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;

//   if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
//     console.log(`[${timestamp}] [UPLOAD] No files in upload request for patient:`, { silknotePatientUuid, requestId });
//     return res.status(400).json({ error: 'No files uploaded' });
//   }

//   try {
//     console.log(`[${timestamp}] [UPLOAD] Processing upload request:`, {
//       silknotePatientUuid,
//       fileCount: req.files.length,
//       requestId
//     });
    
//     const files = req.files;
//     const fileTimestamp = new Date().toISOString();
//     const metadataRecords: MedicalDocument[] = [];

//     // Process files in parallel
//     const processPromises = files.map(async (file) => {
//       // Cast documentService to any so that the missing initiateProcessing method does not raise a type error.
//       const { id: documentId, status } = await (documentService as any).initiateProcessing(file, silknotePatientUuid);
      
//       const metadata: MedicalDocument = {
//         id: documentId,
//         silknotePatientUuid,
//         originalName: file.originalname,
//         storedPath: file.path,
//         status: status,
//         category: DocumentType.UNPROCESSED,
//         type: file.mimetype,
//         size: file.size,
//         title: file.originalname,
//         format: {
//           mimeType: file.mimetype,
//           extension: file.originalname.split('.').pop() || ''
//         },
//         fileSize: file.size,
//         pageCount: 0,
//         documentDate: fileTimestamp,
//         uploadDate: fileTimestamp,
//         processedAt: undefined,
//         author: '',
//         sourceSystem: 'upload',
//         confidence: 0,
//         filename: file.originalname,
//         content: {
//           analysisResult: null,
//           extractedSchemas: [],
//           enrichedSchemas: [],
//           pageImages: []
//         }
//       };
      
//       console.log(`[${fileTimestamp}] [UPLOAD] Adding file to patient:`, truncateForLogging({
//         documentId,
//         silknotePatientUuid,
//         fileName: file.originalname,
//         status
//       }));
      
//       const fileBuffer = fs.readFileSync(file.path);
//       await patientService.addFileToPatient(silknotePatientUuid, metadata, fileBuffer);
//       metadataRecords.push(metadata);

//       // Emit fileAdded event with the complete metadata (required for frontend processing)
//       // Log the truncated version for debugging, but emit the full object
//       console.log(`[${fileTimestamp}] [UPLOAD] Emitting fileAdded event:`, truncateForLogging(metadata));
//       io.to(silknotePatientUuid).emit('fileAdded', metadata);

//       return metadata;
//     });

//     await Promise.all(processPromises)
//       .then(async () => {
//         console.log(`[${fileTimestamp}] [UPLOAD] All files initialized for processing`);
//         // Start processing the files
//         await fileService.processUnprocessedFiles(silknotePatientUuid);
//       })
//       .catch(error => {
//         console.log(`[${fileTimestamp}] [UPLOAD] Error initializing files:`, error);
//       });

//     // Respond immediately with accepted status
//     return res.status(202).json({ 
//       message: 'Files accepted for processing',
//       files: metadataRecords.map(meta => ({
//         id: meta.id,
//         originalName: meta.originalName,
//         status: meta.status
//       }))
//     });
//   } catch (error) {
//     const errorTimestamp = new Date().toISOString();
//     console.log(`[${errorTimestamp}] [UPLOAD] Error processing upload request:`, error);
//     return res.status(500).json({ error: 'Error processing upload request' });
//   }
// });

// export default router;