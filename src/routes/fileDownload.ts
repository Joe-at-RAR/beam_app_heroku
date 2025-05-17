import express, { Router } from 'express';
import { getFileById } from '../services/fileService';

const router: Router = express.Router();

router.get('/:silknotePatientUuid/files/:fileId', async (req, res) => {
  const { silknotePatientUuid, fileId } = req.params;
  try {
    const file = await getFileById(fileId);
    if (!file || file.silknotePatientUuid !== silknotePatientUuid) {
      return res.status(404).json({ error: 'File not found or unauthorized' });
    }
    // Stream/download the file using the stored path
    return res.download(file.storedPath, file.originalName);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router; 