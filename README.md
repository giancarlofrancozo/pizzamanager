#  PizzaManager — Sistema de Gestão para Pizzarias e Restaurantes

Sistema completo e moderno para gestão operacional de pizzarias, salões e delivery, desenvolvido com foco em alta performance, robustez offline/local e facilidade de operação.

---

##  Principais Módulos e Recursos

### 🍽️ Gestão de Salão & Mesas
- Visualização em grade e cartões dinâmicos com status em tempo real (Livre, Ocupada, Pronta no KDS, Em Conta/Fechamento).
- Abertura rápida de mesas via teclado (`DEL` + número da mesa).
- Transferência e união de mesas.
- Divisão de conta por pessoas ou itens individuais.

###  Vendas de Balcão
- Painel dedicado de comandas de balcão com contadores em tempo real.
- Suporte a acréscimo de itens em comandas abertas com impressão seletiva na cozinha (somente novos itens).
- Histórico de pedidos e identificação de clientes cadastrados.

###  Delivery & Painel Kanban
- Fluxo de pedidos em 3 colunas (*Em Preparo*, *Despacho/Retirada*, *Em Entrega*).
- Cálculo automático de taxa de entrega por bairro ou valor personalizado.
- Controle de troco, forma de pagamento e observações de entrega.
- Atribuição de entregadores (motoboys) e despacho com 1 clique.

###  Cozinha & KDS (Kitchen Display System)
- Tela de produção para a equipe da cozinha em tempo real.
- Avanço de estágios de preparo (*Montagem*, *Forno*, *Finalização/Pronto*).
- Alertas visuais de tempo de espera e itens urgentes.

###  Impressão Térmica ESC/POS por Setor
- Roteamento inteligente de impressão para impressoras de rede/USB (Cozinha, Forno, Bar, Caixa).
- Impressão automática de comandas de produção e cupons de conferência.
- Visualizador e preview térmico integrado no navegador.

###  Emissão Fiscal NFC-e
- Integração para emissão de Nota Fiscal de Consumidor Eletrônica (NFC-e).
- Emissão em 1 clique ou automática no faturamento da conta (`F9`).
- Suporte a CPF na nota e cancelamento de notas fiscais.

###  App Garçom (Android & Web)
- Interface web responsiva e aplicativo nativo APK (`/download/Caseiro-Pizzaria.apk`) para dispositivos móveis dos garçons.
- Lançamento rápido de pedidos diretamente nas mesas.

---

##  Tecnologias Utilizadas

- **Backend:** Node.js (v18+) + Express
- **Banco de Dados:** SQLite com Sequelize ORM (modo WAL para alta concorrência)
- **Frontend:** Vanilla JavaScript, HTML5 e CSS3 (sem dependência de frameworks pesados, carregamento instantâneo)
- **Comunicação / API:** RESTful API com autenticação JWT
- **Desktop Launcher:** Executável leve em C# (.NET) para inicialização em segundo plano no Windows

---

##  Pré-requisitos

- [Node.js](https://nodejs.org/) versão 18 ou superior
- Sistema Operacional: Windows 10/11 ou Linux/macOS

---

##  Instalação e Execução

### 1. Clonar o repositório
```bash
git clone https://github.com/SEU_USUARIO/pizzamanager.git
cd pizzamanager
```

### 2. Instalar dependências
```bash
npm install
```

### 3. Iniciar o servidor
```bash
npm start
```
*No Windows, você também pode simplesmente dar um duplo clique em `start_server.bat` ou utilizar o executável `PizzaManager.exe`.*

### 4. Acessar o sistema
Abra o navegador em:
```
http://localhost:3000
```

> **Credenciais padrão iniciais:**
> - **Usuário:** `admin`
> - **Senha:** `123`

---

##  Estrutura de Pastas

```text
├── db/              # Diretório do banco de dados SQLite local
├── middleware/      # Middlewares do Express (autenticação JWT, permissões)
├── models/          # Modelos de dados do Sequelize (Pedidos, Itens, Produtos, etc.)
├── public/          # Interface Web (HTML, CSS, JS, APKs para download)
│   ├── app.js       # SPA do sistema de gestão do caixa/gerente
│   ├── garcom.html  # PWA / App mobile para garçons
│   └── style.css    # Folha de estilos
├── routes/          # Rotas e controladores da API REST
├── services/        # Serviços auxiliares (NFC-e, status de pedidos)
├── server.js        # Ponto de entrada do servidor Express
└── package.json     # Metadados e dependências do projeto
```

---

##  Licença

Este projeto é distribuído sob a licença [MIT](LICENSE).
