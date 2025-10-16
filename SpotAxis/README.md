# SpotAxis

Version: 1.0 

SpotAxis is an Open-source (MIT Licensed) Applicant Tracking System to streamline your hiring process.

Our vision is to create the most adapted open-source Applicant Tracking System (ATS) that helps businesses to seamlessly manage the entire recruitment process, from attracting candidates to scheduling interviews, making hiring decisions and onboarding.

## SpotAxis can satisfy the use cases of two types of users ##

### 1. End users(Companies): ###
These are organizations that want to directly manage their own recruitment process using Spotaxis.

The key features for end users include the following
1. Post jobs and maintain job templates
2. Get your custom branded Career websites
3. Parse resumes of each applicant
4. Provide custom application form to candidates
5. Collaborative hiring
6. Custom hiring pipeline for each job
7. Custom rating for candidates in each hiring round
8. Compare ratings of each candidate

### 2. Developers/Entrepreneurs: ###
Can customize Spotaxis, add features, and host it for other companies to use as a subscription service(SaaS).

The key features for this user type include the following
1. Everything of End users
2. Manage multiple organizations as a super admin
3. Use the default Job Board that is pulled from all the organizations.
4. Manage jobs and applicants as a super admin
5. Subscription/Pricing Management for ATS

If you need support implementing this ATS on your server, please reach out to holesh+ats@assystant.com

## Contributors required ##

1. You can submit bugs  and help us verify as they are live
2. Contribute to bug fixes
3. Review and collaborate on source code changes
4. Write and improve SpotAxis documentation
5. Contribute new feature development

## Project Dependencies ##

### Runtime Environment
* **Python**: 3.11+ (recommended) or 3.12
* **Django**: 5.2.1
* **Database**: PostgreSQL (recommended) or MySQL
* **Web Server**: Gunicorn (production) or Waitress

### Core Dependencies
* **Django & Extensions**
  * django==5.2.1
  * djangorestframework==3.16.0
  * django-rosetta==0.10.2 (translations)
  * django-crontab==0.7.1 (scheduled tasks)
  * django-extensions==4.1.0
  * django-filter==25.1
  * django-contrib-comments==2.2.0
  * django-mptt==0.17.0
  * django-tagging==0.5.0
  * django-bootstrap-form==3.4

* **UI Components**
  * django-ckeditor==6.7.0 (WYSIWYG editor)
  * django-el-pagination==4.0.0

* **Forms & Validation**
  * django-nested-formset==0.1.4
  * django-phonenumber-field==7.3.0
  * phonenumbers==8.13.27
  * validate-email==1.3

* **Document Processing**
  * weasyprint==65.1 (PDF generation)
  * pypdf==5.5.0
  * python-docx==1.1.2
  * mammoth==1.9.1 (DOCX to HTML)
  * pdfminer-six==20250506 (PDF parsing)
  * markdownify==1.1.0
  * beautifulsoup4==4.13.4
  * striprtf==0.0.26

* **Data Processing**
  * dicttoxml==1.7.16
  * simplejson==3.19.2
  * pyth==0.6.0

* **Email & Communication**
  * email-reply-parser==0.5.12

* **Authentication & Security**
  * oauth2==1.9.0.post1
  * oauthlib==3.2.2
  * requests-oauthlib==2.0.0
  * pyopenssl==25.1.0
  * cryptography==45.0.3
  * hashids==1.3.1

* **Database**
  * psycopg[binary]==3.2.3 (PostgreSQL driver)
  * pymysql==1.1.1 (MySQL driver - optional)

* **Web Scraping & Automation**
  * selenium==4.33.0
  * requests==2.32.3
  * beautifulsoup4==4.13.4

* **Utilities**
  * python-dateutil==2.9.0.post0
  * pytz==2025.2
  * pillow==11.2.1
  * six==1.17.0
  * unidecode==1.4.0
  * regex==2024.11.6

* **Development & Testing**
  * python-dotenv==1.0.1 (environment variables)

* **Payment Processing**
  * paypalrestsdk==1.13.3

* **Server (Production)**
  * gunicorn==21.2.0
  * waitress==3.0.2

### System Dependencies (for Docker/Production)
Required for WeasyPrint PDF generation:
* libpango-1.0-0, libpangocairo-1.0-0
* libcairo2, libgdk-pixbuf-2.0-0
* libglib2.0-0, libgobject-2.0-0
* libharfbuzz0b, libffi8
* fonts-dejavu-core, fonts-liberation

### Installation

See `requirements.txt` for complete dependency list with pinned versions.

```bash
pip install -r requirements.txt
```

### Docker Deployment

A `Dockerfile` is provided for containerized deployment with all system dependencies pre-installed.

```bash
docker build -t spotaxis .
docker run -p 8000:8000 spotaxis
```

### Railway/Cloud Deployment

The project includes:
* `Dockerfile` - Container configuration with WeasyPrint system libraries
* `railway.json` - Railway platform configuration
* `.dockerignore` - Docker build optimization

**Last Updated**: October 2025 - Modernized for Python 3.11+ and Django 5.2
