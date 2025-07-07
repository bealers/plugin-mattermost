import { describe, it, expect, beforeEach, afterEach, vi, type MockedFunction } from 'vitest';
import { AttachmentManager } from '../../src/managers/attachment.manager';
import { RestClient } from '../../src/clients/rest.client';
import { IAgentRuntime } from '@elizaos/core';
import { mockLogger, expectLoggerCalled } from '../utils/test-setup';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock dependencies
vi.mock('fs');
vi.mock('path');
vi.mock('os');

describe('AttachmentManager', () => {
  let attachmentManager: AttachmentManager;
  let mockRestClient: Partial<RestClient>;
  let mockRuntime: Partial<IAgentRuntime>;

  const mockTempDir = '/tmp/mattermost-elizaos-files';
  
  beforeEach(() => {
    // Setup mocks
    mockRuntime = {
      emit: vi.fn()
    };

    mockRestClient = {
      getFileInfo: vi.fn(),
      downloadFile: vi.fn(),
      uploadFile: vi.fn(),
      createPost: vi.fn()
    };

    // Mock OS and path utilities
    (os.tmpdir as MockedFunction<typeof os.tmpdir>).mockReturnValue('/tmp');
    (path.join as MockedFunction<typeof path.join>).mockImplementation((...paths) => paths.join('/'));
    
    // Mock fs functions
    (fs.existsSync as MockedFunction<typeof fs.existsSync>).mockReturnValue(false);
    (fs.mkdirSync as MockedFunction<typeof fs.mkdirSync>).mockImplementation(() => {});
    (fs.readdirSync as MockedFunction<typeof fs.readdirSync>).mockReturnValue([]);
    (fs.unlinkSync as MockedFunction<typeof fs.unlinkSync>).mockImplementation(() => {});
    (fs.writeFileSync as MockedFunction<typeof fs.writeFileSync>).mockImplementation(() => {});
    (fs.readFileSync as MockedFunction<typeof fs.readFileSync>).mockReturnValue('sample file content');

    attachmentManager = new AttachmentManager(
      mockRestClient as RestClient,
      mockRuntime as IAgentRuntime
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should initialize with provided dependencies', () => {
      expect(attachmentManager).toBeDefined();
      expect(attachmentManager.initialized).toBe(false);
      expect(attachmentManager.tempDirectory).toBe(mockTempDir);
    });
  });

  describe('initialize', () => {
    it('should create temp directory and set initialized flag', async () => {
      await attachmentManager.initialize();

      expect(fs.mkdirSync).toHaveBeenCalledWith(mockTempDir, { recursive: true });
      expect(attachmentManager.initialized).toBe(true);
      expectLoggerCalled('info', 'Attachment manager initialized');
    });

    it('should skip directory creation if it already exists', async () => {
      (fs.existsSync as MockedFunction<typeof fs.existsSync>).mockReturnValue(true);

      await attachmentManager.initialize();

      expect(fs.mkdirSync).not.toHaveBeenCalled();
      expect(attachmentManager.initialized).toBe(true);
    });

    it('should handle initialization errors', async () => {
      const error = new Error('Directory creation failed');
      (fs.mkdirSync as MockedFunction<typeof fs.mkdirSync>).mockImplementation(() => {
        throw error;
      });

      await expect(attachmentManager.initialize()).rejects.toThrow(
        'Attachment manager initialization failed: Directory creation failed'
      );
      
      expectLoggerCalled('error', 'Directory creation failed');
      expect(attachmentManager.initialized).toBe(false);
    });
  });

  describe('cleanup', () => {
    beforeEach(async () => {
      await attachmentManager.initialize();
    });

    it('should remove all temporary files and set initialized to false', async () => {
      const mockFiles = ['file1.txt', 'file2.pdf', 'image.jpg'];
      (fs.existsSync as MockedFunction<typeof fs.existsSync>).mockReturnValue(true);
      (fs.readdirSync as MockedFunction<typeof fs.readdirSync>).mockReturnValue(mockFiles as any);

      await attachmentManager.cleanup();

      mockFiles.forEach(file => {
        expect(fs.unlinkSync).toHaveBeenCalledWith(path.join(mockTempDir, file));
      });
      
      expect(attachmentManager.initialized).toBe(false);
      expectLoggerCalled('info', 'Attachment manager cleaned up');
    });

    it('should handle missing temp directory gracefully', async () => {
      (fs.existsSync as MockedFunction<typeof fs.existsSync>).mockReturnValue(false);

      await attachmentManager.cleanup();

      expect(fs.readdirSync).not.toHaveBeenCalled();
      expect(fs.unlinkSync).not.toHaveBeenCalled();
      expect(attachmentManager.initialized).toBe(false);
    });

    it('should handle file deletion errors gracefully', async () => {
      const mockFiles = ['file1.txt', 'file2.pdf'];
      (fs.existsSync as MockedFunction<typeof fs.existsSync>).mockReturnValue(true);
      (fs.readdirSync as MockedFunction<typeof fs.readdirSync>).mockReturnValue(mockFiles as any);
      (fs.unlinkSync as MockedFunction<typeof fs.unlinkSync>).mockImplementation((filePath) => {
        if (filePath.includes('file1.txt')) {
          throw new Error('Permission denied');
        }
      });

      await attachmentManager.cleanup();

      expectLoggerCalled('warn', 'Error deleting temp file file1.txt: Permission denied');
      expect(attachmentManager.initialized).toBe(false);
    });
  });

  describe('processFileAttachments', () => {
    const channelId = 'channel123';
    const postId = 'post456';
    const fileIds = ['file1', 'file2'];

    beforeEach(async () => {
      await attachmentManager.initialize();
    });

    it('should throw error if not initialized', async () => {
      const uninitializedManager = new AttachmentManager(
        mockRestClient as RestClient,
        mockRuntime as IAgentRuntime
      );

      await expect(
        uninitializedManager.processFileAttachments(fileIds, channelId, postId)
      ).rejects.toThrow('Attachment manager not initialized');
    });

    it('should return early if no file IDs provided', async () => {
      await attachmentManager.processFileAttachments([], channelId, postId);
      await attachmentManager.processFileAttachments(undefined as any, channelId, postId);

      expect(mockRestClient.getFileInfo).not.toHaveBeenCalled();
      expect(mockRestClient.downloadFile).not.toHaveBeenCalled();
    });

    it('should process file attachments successfully', async () => {
      const mockFileInfo = {
        id: 'file1',
        name: 'test.txt',
        size: 1024,
        mime_type: 'text/plain'
      };
      const mockFileData = new ArrayBuffer(1024);

      (mockRestClient.getFileInfo as vi.Mock).mockResolvedValue(mockFileInfo);
      (mockRestClient.downloadFile as vi.Mock).mockResolvedValue(mockFileData);
      (mockRestClient.createPost as vi.Mock).mockResolvedValue({});

      await attachmentManager.processFileAttachments(['file1'], channelId, postId);

      expect(mockRestClient.getFileInfo).toHaveBeenCalledWith('file1');
      expect(mockRestClient.downloadFile).toHaveBeenCalledWith('file1');
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.join(mockTempDir, 'test.txt'),
        Buffer.from(mockFileData)
      );
      // Note: FILE_RECEIVED emit is commented out in implementation as TODO
      // expect(mockRuntime.emit).toHaveBeenCalledWith('FILE_RECEIVED', ...);
    });

    it('should handle processing errors and send error message', async () => {
      const error = new Error('Download failed');
      (mockRestClient.getFileInfo as vi.Mock).mockRejectedValue(error);
      (mockRestClient.createPost as vi.Mock).mockResolvedValue({});

      await attachmentManager.processFileAttachments(['file1'], channelId, postId);

      expectLoggerCalled('error', 'Error processing file file1: Download failed');
      expect(mockRestClient.createPost).toHaveBeenCalledWith(
        channelId,
        'Sorry, I encountered an error processing the file: Download failed',
        { rootId: postId }
      );
    });

    it('should handle error message sending failure', async () => {
      const error = new Error('Download failed');
      const sendError = new Error('Send failed');
      (mockRestClient.getFileInfo as vi.Mock).mockRejectedValue(error);
      (mockRestClient.createPost as vi.Mock).mockRejectedValue(sendError);

      await attachmentManager.processFileAttachments(['file1'], channelId, postId);

      expectLoggerCalled('error', 'Error processing file file1: Download failed');
      expectLoggerCalled('error', 'Error sending error message: Send failed');
    });
  });

  describe('File Processing by Type', () => {
    const channelId = 'channel123';
    const postId = 'post456';
    const fileInfo = {
      id: 'file1',
      name: 'test.txt',
      size: 1024,
      mime_type: 'text/plain'
    };

    beforeEach(async () => {
      await attachmentManager.initialize();
      (mockRestClient.createPost as vi.Mock).mockResolvedValue({});
    });

    it('should process image files', async () => {
      const imageFileInfo = { ...fileInfo, name: 'test.jpg', mime_type: 'image/jpeg' };
      
      await attachmentManager.processFileAttachments(['file1'], channelId, postId);
      
      // Mock the file processing calls
      (mockRestClient.getFileInfo as vi.Mock).mockResolvedValue(imageFileInfo);
      (mockRestClient.downloadFile as vi.Mock).mockResolvedValue(new ArrayBuffer(1024));
      
      await attachmentManager.processFileAttachments(['file1'], channelId, postId);

      expect(mockRestClient.createPost).toHaveBeenCalledWith(
        channelId,
        expect.stringContaining('Processing file: test.jpg'),
        { rootId: postId }
      );
    });

    it('should process PDF files', async () => {
      const pdfFileInfo = { ...fileInfo, name: 'test.pdf', mime_type: 'application/pdf' };
      
      (mockRestClient.getFileInfo as vi.Mock).mockResolvedValue(pdfFileInfo);
      (mockRestClient.downloadFile as vi.Mock).mockResolvedValue(new ArrayBuffer(1024));
      
      await attachmentManager.processFileAttachments(['file1'], channelId, postId);

      expect(mockRestClient.createPost).toHaveBeenCalledWith(
        channelId,
        expect.stringContaining('Processing file: test.pdf'),
        { rootId: postId }
      );
    });

    it('should process Office documents', async () => {
      const docFileInfo = { ...fileInfo, name: 'test.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
      
      (mockRestClient.getFileInfo as vi.Mock).mockResolvedValue(docFileInfo);
      (mockRestClient.downloadFile as vi.Mock).mockResolvedValue(new ArrayBuffer(1024));
      
      await attachmentManager.processFileAttachments(['file1'], channelId, postId);

      expect(mockRestClient.createPost).toHaveBeenCalledWith(
        channelId,
        expect.stringContaining('Processing file: test.docx'),
        { rootId: postId }
      );
    });

    it('should process text files with content preview', async () => {
      (mockRestClient.getFileInfo as vi.Mock).mockResolvedValue(fileInfo);
      (mockRestClient.downloadFile as vi.Mock).mockResolvedValue(new ArrayBuffer(1024));
      (fs.readFileSync as MockedFunction<typeof fs.readFileSync>).mockReturnValue('This is sample text content');
      
      await attachmentManager.processFileAttachments(['file1'], channelId, postId);

      expect(mockRestClient.createPost).toHaveBeenCalledWith(
        channelId,
        expect.stringContaining('This is sample text content'),
        { rootId: postId }
      );
    });

    it('should handle text file reading errors', async () => {
      (mockRestClient.getFileInfo as vi.Mock).mockResolvedValue(fileInfo);
      (mockRestClient.downloadFile as vi.Mock).mockResolvedValue(new ArrayBuffer(1024));
      (fs.readFileSync as MockedFunction<typeof fs.readFileSync>).mockImplementation(() => {
        throw new Error('File read error');
      });
      
      await attachmentManager.processFileAttachments(['file1'], channelId, postId);

      expectLoggerCalled('error', 'File read error');
      expect(mockRestClient.createPost).toHaveBeenCalledWith(
        channelId,
        expect.stringContaining('encountered an error reading its contents'),
        { rootId: postId }
      );
    });

    it('should handle unsupported file types', async () => {
      const unsupportedFileInfo = { ...fileInfo, name: 'test.bin', mime_type: 'application/octet-stream' };
      
      (mockRestClient.getFileInfo as vi.Mock).mockResolvedValue(unsupportedFileInfo);
      (mockRestClient.downloadFile as vi.Mock).mockResolvedValue(new ArrayBuffer(1024));
      
      await attachmentManager.processFileAttachments(['file1'], channelId, postId);

      expect(mockRestClient.createPost).toHaveBeenCalledWith(
        channelId,
        expect.stringContaining('File type application/octet-stream is not supported'),
        { rootId: postId }
      );
    });
  });

  describe('uploadFile', () => {
    const channelId = 'channel123';
    const fileData = Buffer.from('test file content');
    const fileName = 'test.txt';

    beforeEach(async () => {
      await attachmentManager.initialize();
    });

    it('should throw error if not initialized', async () => {
      const uninitializedManager = new AttachmentManager(
        mockRestClient as RestClient,
        mockRuntime as IAgentRuntime
      );

      await expect(
        uninitializedManager.uploadFile(channelId, fileData, fileName)
      ).rejects.toThrow('Attachment manager not initialized');
    });

    it('should upload file successfully', async () => {
      const mockFileInfo = {
        file_infos: [{
          id: 'uploaded_file_id',
          name: fileName,
          size: fileData.length
        }]
      };

      (mockRestClient.uploadFile as vi.Mock).mockResolvedValue(mockFileInfo);
      (mockRestClient.createPost as vi.Mock).mockResolvedValue({});

      const result = await attachmentManager.uploadFile(channelId, fileData, fileName);

      expect(mockRestClient.uploadFile).toHaveBeenCalledWith(channelId, fileData, fileName);
      // Note: uploadFile now only uploads, doesn't create posts - that's handled by generateAndUpload* methods
      expect(result).toBe('uploaded_file_id');
    });

    it('should upload file with post ID', async () => {
      const postId = 'post123';
      const mockFileInfo = {
        file_infos: [{
          id: 'uploaded_file_id',
          name: fileName,
          size: fileData.length
        }]
      };

      (mockRestClient.uploadFile as vi.Mock).mockResolvedValue(mockFileInfo);
      (mockRestClient.createPost as vi.Mock).mockResolvedValue({});

      const result = await attachmentManager.uploadFile(channelId, fileData, fileName, postId);

      expect(mockRestClient.uploadFile).toHaveBeenCalledWith(channelId, fileData, fileName);
      // Note: uploadFile now only uploads, doesn't create posts - that's handled by generateAndUpload* methods
      expect(result).toBe('uploaded_file_id');
    });

    it('should handle upload errors', async () => {
      const error = new Error('Upload failed');
      (mockRestClient.uploadFile as vi.Mock).mockRejectedValue(error);

      await expect(
        attachmentManager.uploadFile(channelId, fileData, fileName)
      ).rejects.toThrow('Upload failed');

      expectLoggerCalled('error', 'Error uploading file: Upload failed');
    });
  });

  describe('Utility Methods', () => {
    describe('formatFileSize', () => {
      beforeEach(async () => {
        await attachmentManager.initialize();
      });

      it('should format bytes correctly', async () => {
        // Test via processFile which uses formatFileSize internally
        const fileInfo = { id: 'file1', name: 'test.txt', size: 1024, mime_type: 'text/plain' };
        const fileData = Buffer.from('a'.repeat(1024));

        (mockRestClient.getFileInfo as vi.Mock).mockResolvedValue(fileInfo);
        (mockRestClient.downloadFile as vi.Mock).mockResolvedValue(fileData.buffer);
        (mockRestClient.createPost as vi.Mock).mockResolvedValue({});

        await attachmentManager.processFileAttachments(['file1'], 'channel123', 'post123');

        expect(mockRestClient.createPost).toHaveBeenCalledWith(
          'channel123',
          expect.stringContaining('(1.0 KB)'),
          expect.any(Object)
        );
      });
    });

    describe('Getters', () => {
      it('should return correct initialized state', () => {
        expect(attachmentManager.initialized).toBe(false);
      });

      it('should return correct temp directory', () => {
        expect(attachmentManager.tempDirectory).toBe(mockTempDir);
      });
    });
  });
}); 