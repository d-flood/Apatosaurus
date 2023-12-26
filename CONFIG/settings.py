"""
Django settings for CONFIG project.

Generated by 'django-admin startproject' using Django 4.1.3.

For more information on this file, see
https://docs.djangoproject.com/en/4.1/topics/settings/

For the full list of settings and their values, see
https://docs.djangoproject.com/en/4.1/ref/settings/
"""
from os import environ
from pathlib import Path

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent


# Quick-start development settings - unsuitable for production
# See https://docs.djangoproject.com/en/4.1/howto/deployment/checklist/

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = environ.get("SECRET_KEY")
ADMIN_URL = environ.get("ADMIN_URL", "admin")
ADMINS = [
    ("admin", environ.get("ADMIN_EMAIL")),
]
SITE_ID = 1

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = environ.get("DEBUG") == "True"

ALLOWED_HOSTS = [
    "*",
]


# Application definition

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.sites",
    "collation",
    "accounts",
    "cbgm",
    "published",
    "witnesses",
    "content",
    "tools",
    "django_htmx",
    "crispy_forms",
    "tailwind",
    "theme",
    "django_browser_reload",
    "impersonate",
    "peasywidgets",
    "transcriptions",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "django_htmx.middleware.HtmxMiddleware",
    "django_browser_reload.middleware.BrowserReloadMiddleware",
    "impersonate.middleware.ImpersonateMiddleware",
]

ROOT_URLCONF = "CONFIG.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": ["_templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "CONFIG.wsgi.application"


# Database
# https://docs.djangoproject.com/en/4.1/ref/settings/#databases

if environ.get("USE_PRODUCTION_DB") != "True":
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": "postgres",
            "USER": "postgres",
            "PASSWORD": "atestpasswordforgettingup",
            "HOST": "db",
            "PORT": 5432,
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": environ.get("PRODUCTION_POSTGRES_NAME"),
            "USER": environ.get("PRODUCTION_POSTGRES_USER"),
            "PASSWORD": environ.get("PRODUCTION_POSTGRES_PASSWORD"),
            "HOST": environ.get("PRODUCTION_POSTGRES_HOST"),
            "PORT": 5432,
        }
    }


CACHE_TTL = 60

# Password validation
# https://docs.djangoproject.com/en/4.1/ref/settings/#auth-password-validators

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]

AUTH_USER_MODEL = "accounts.CustomUser"


# Internationalization
# https://docs.djangoproject.com/en/4.1/topics/i18n/

LANGUAGE_CODE = "en-us"

TIME_ZONE = "UTC"

USE_I18N = True

USE_TZ = True

# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/4.1/howto/static-files/

STATIC_URL = "/static/"
WHITE_NOISE_PREFIX = "/static/"
STATICFILES_DIRS = [BASE_DIR / "_static"]
STATIC_ROOT = BASE_DIR / "_staticfiles"
STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "_media"

AWS_STORAGE_BUCKET_NAME = environ.get("AWS_STORAGE_BUCKET_NAME")

DEFAULT_FILE_STORAGE = "CONFIG.custom.LambdaStorage"

# Default primary key field type
# https://docs.djangoproject.com/en/4.1/ref/settings/#default-auto-field

CSRF_TRUSTED_ORIGINS = [
    "https://apatosaurus.io",
    "https://www.apatosaurus.io",
    "https://dev.apatosaurus.io",
    # 'http://localhost',
    # 'https://localhost',
]

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

TAILWIND_APP_NAME = "theme"

INTERNAL_IPS = [
    "127.0.0.1",
]

LOGIN_REDIRECT_URL = "user-profile"
LOGOUT_REDIRECT_URL = "login"
ACCOUNT_ACTIVATION_DAYS = 7
REGISTRATION_OPEN = True

EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST = environ.get("EMAIL_HOST")
EMAIL_HOST_USER = environ.get("EMAIL_HOST_USER")
EMAIL_HOST_PASSWORD = environ.get("EMAIL_HOST_PASSWORD")
EMAIL_PORT = int(environ.get("EMAIL_PORT", 0))
EMAIL_USE_TLS = True

# CACHES = {
#     'default': {
#         'BACKEND': 'django.core.cache.backends.redis.RedisCache',
#         'LOCATION': 'redis:6379',
#     },
# }
