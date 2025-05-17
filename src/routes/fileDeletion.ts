import express from 'express';
import { deleteFileFromPatient } from '../services/patientService';
import { deleteFile } from '../services/fileService';
import { io } from '../socket';

const router: express.Router = express.Router();

router.delete('/:silknotePatientUuid/files/:fileId', async (req, res) => {
  const { silknotePatientUuid, fileId } = req.params;
  try {
    // Delete the physical file and thumbnails
    await deleteFile(fileId);
    // Remove file metadata from the patient record
    await deleteFileFromPatient(silknotePatientUuid, fileId);
    // Emit the fileDeleted event for real-time UI updates
    io.emit('fileDeleted', { silknotePatientUuid, fileId });
    res.status(204).end();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router; 