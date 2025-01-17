const cors = require('cors');
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const sqlite3 = require('sqlite3').verbose();
const cheerio = require("cheerio");
const app = express();
app.use(express.json()); // Adicione esta linha
app.use(cors()); // Habilita CORS para todas as rotas
const PORT = process.env.PORT || 4000;
const https = require('https');
const httpsOptions = {
  key: fs.readFileSync('/etc/letsencrypt/live/saikanet.online/privkey.pem'),
  cert: fs.readFileSync('/etc/letsencrypt/live/saikanet.online/fullchain.pem')
};

// Caminho da pasta onde os arquivos estão armazenados
const FILES_DIR = path.join(__dirname, 'mangas');

// Caminho do banco de dados
const DB_PATH = path.join(__dirname, 'db.db');

const upload = multer({
  dest: path.join(__dirname, 'uploads'),
  limits: { fileSize: 10 * 1024 * 1024 }, // Limite de tamanho de 10 MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Arquivo inválido. Apenas imagens são permitidas.'));
    }
    cb(null, true);
  },
});

// Funções principais
const functions_main = {
  function_criar_pastas: function () {
    if (!fs.existsSync(FILES_DIR)) {
      fs.mkdirSync(FILES_DIR, { recursive: true }); // Cria a pasta, incluindo subpastas, se necessário
      console.log(`A pasta "${FILES_DIR}" foi criada.`);
    }
  },

  function_iniciarbancodedados: function() {
    const db = new sqlite3.Database(DB_PATH);

    db.serialize(() => {
      // Cria a tabela para armazenar versões, se não existir
      db.run(`
        CREATE TABLE IF NOT EXISTS versions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          version INTEGER NOT NULL UNIQUE,
          file_name TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) {
          console.error('Erro ao criar tabela "versions":', err);
        } else {
          console.log('Tabela "versions" criada ou já existe.');
        }
      });
    
      // Cria a tabela para armazenar as licenças de template de site, se não existir
      db.run(`
        CREATE TABLE IF NOT EXISTS site_licenses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          url TEXT NOT NULL,
          site_usuario TEXT NOT NULL,
          license_key TEXT NOT NULL UNIQUE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) {
          console.error('Erro ao criar tabela "site_licenses":', err);
        } else {
          console.log('Tabela "site_licenses" criada ou já existe.');
        }
      });
    });
    return db;

  },
};

// Configurações principais
function settings_main() {
  functions_main.function_criar_pastas(); // Gera as pastas necessárias
}
settings_main();


const db = functions_main.function_iniciarbancodedados();

const functions_check_update = {
  getLastSavedVersion: function() {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM versions ORDER BY version DESC LIMIT 1',
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(row);
          }
        }
      );
    });

  },

  saveNewVersion: function(version, fileName) {
    return new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO versions (version, file_name) VALUES (?, ?)',
        [version, fileName],
        function (err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.lastID); // Retorna o ID do novo registro
          }
        }
      );
    });
  },

  getLatestZipFile: function() {
    const files = fs.readdirSync(FILES_DIR);
    const zipFiles = files.filter(file => file.endsWith('.zip'));
  
    // Retorna o primeiro arquivo ZIP encontrado
    return zipFiles[0] || null;
  }
}
// Rota para verificar e baixar a nova versão
app.get('/check-update-template-mangas', async (req, res) => {
  try {
    const clientVersion = req.query.version; // Versão enviada pelo cliente
    const latestZipFile = functions_check_update.getLatestZipFile();

    if (!latestZipFile) {
      return res.status(404).json({ error: 'Nenhuma versão disponível.' });
    }

    // Verifica a última versão registrada no banco
    const lastSavedVersion = await functions_check_update.getLastSavedVersion();

    // Se não houver versões registradas ou a versão atual for diferente, considere como nova versão
    if (!lastSavedVersion || latestZipFile !== lastSavedVersion.file_name) {
      const newVersion = lastSavedVersion ? lastSavedVersion.version + 1 : 1; // Incrementa a versão
      await functions_check_update.saveNewVersion(newVersion, latestZipFile);
      console.log(`Versão ${newVersion} registrada no banco de dados.`);

      // Envia o arquivo para o cliente
      const filePath = path.join(FILES_DIR, latestZipFile);
      res.download(filePath, latestZipFile, (err) => {
        if (err) {
          console.error('Erro ao enviar o arquivo:', err);
          return res.status(500).json({ error: 'Erro ao baixar o arquivo.' });
        }
      });
    } else {
      return res.json({ message: 'Você já está usando a versão mais recente.' });
    }
  } catch (error) {
    console.error('Erro ao verificar a versão:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
});

app.post("/post-image", upload.single("file"), async (req, res) => {
  const rota_post_image = "https://postimg.cc/json?q=a";

  try {
    // Verifica se o arquivo foi enviado
    if (!req.file) {
      return res.status(400).json({ error: "Nenhum arquivo foi enviado." });
    }

    // Configura o formulário de dados para a solicitação
    const formData = new FormData();
    formData.append("action", "upload");
    formData.append("numfiles", "1");
    formData.append("gallery", "");
    formData.append("adult", "");
    formData.append("ui", "");
    formData.append("optsize", "");
    formData.append("upload_referer", "https://www.phpbb.com");
    formData.append("mode", "");
    formData.append("lang", "");
    formData.append("content", "");
    formData.append("forumurl", "");
    formData.append("FileFormName", "file");
    formData.append("upload_session", "carmelitaeldora");
    formData.append("file", fs.createReadStream(req.file.path));

    // Faz a solicitação POST para enviar a imagem
    const response = await axios.post(rota_post_image, formData, {
      headers: {
        ...formData.getHeaders(),
      },
    });

    // Remove o arquivo temporário após o envio
    fs.unlinkSync(req.file.path);

    // Verifica se a URL foi retornada corretamente
    if (!response.data || !response.data.url) {
      return res.status(500).json({ error: "A API não retornou uma URL válida." });
    }

    const imageUrl = response.data.url;

    // Faz uma solicitação para o HTML da página da imagem
    const pageResponse = await axios.get(imageUrl);

    // Filtra o HTML para extrair o link da imagem
    const $ = cheerio.load(pageResponse.data);
    const imageLink = $('meta[property="og:image"]').attr("content");

    if (!imageLink) {
      return res.status(500).json({ error: "Não foi possível encontrar o link da imagem no HTML." });
    }

    // Retorna somente o link da imagem
    return res.json({ imageLink });
  } catch (error) {
    console.error("Erro ao enviar a imagem:", error);

    // Remove o arquivo temporário em caso de erro
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }

    return res.status(500).json({ error: "Erro ao enviar a imagem ou processar o HTML retornado." });
  }
});


app.post('/gerar-licenca', (req, res) => {
  const { url, site_usuario } = req.body;

  // Verifique se os dados existem no corpo da requisição
  console.log(req.body);  // Isso ajuda a depurar e verificar o corpo da requisição

  if (!url || !site_usuario) {
    return res.status(400).json({ error: 'URL e site_usuario são obrigatórios.' });
  }

  // Gera uma chave de licença única
  const license_key = generateLicenseKey();

  // Insere a licença no banco de dados
  db.run(
    'INSERT INTO site_licenses (url, site_usuario, license_key) VALUES (?, ?, ?)',
    [url, site_usuario, license_key],
    function (err) {
      if (err) {
        console.error('Erro ao gerar licença:', err);
        return res.status(500).json({ error: 'Erro ao gerar a licença.' });
      }

      console.log('Licença gerada com sucesso:', license_key);
      return res.json({ license_key });
    }
  );
});

// Função para gerar uma chave de licença aleatória
function generateLicenseKey() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Rota para validar uma licença
app.post('/validate-license', (req, res) => {
  const { license_key } = req.body;

  // Verifica se a chave de licença foi fornecida
  if (!license_key) {
    return res.status(400).json({ error: 'Chave de licença é obrigatória.' });
  }

  // Extrai o domínio a partir do cabeçalho Origin ou Host
  const domain = req.get('Origin') || req.get('Referer') || req.get('Host');

  if (!domain) {
    return res.status(400).json({ error: 'Domínio não encontrado na requisição.' });
  }

  // Verifica se a licença existe no banco de dados
  db.get(
    'SELECT * FROM site_licenses WHERE license_key = ?',
    [license_key],
    (err, row) => {
      if (err) {
        console.error('Erro ao validar a licença:', err);
        return res.status(500).json({ error: 'Erro ao validar a licença.' });
      }

      if (!row) {
        return res.status(404).json({ error: 'Licença não encontrada.' });
      }

      // Atualiza a licença no banco de dados com o domínio do site
      db.run(
        'UPDATE site_licenses SET domain = ? WHERE license_key = ?',
        [domain, license_key],
        (updateErr) => {
          if (updateErr) {
            console.error('Erro ao atualizar a licença:', updateErr);
            return res.status(500).json({ error: 'Erro ao atualizar a licença.' });
          }

          console.log('Licença atualizada com sucesso para o domínio:', domain);
          return res.json({ message: 'Licença válida e domínio atualizado.', license_info: row });
        }
      );
    }
  );
});


// Inicia o servidor
https.createServer(httpsOptions, app).listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
