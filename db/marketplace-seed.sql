--
-- PostgreSQL database dump
--


-- Dumped from database version 17.10
-- Dumped by pg_dump version 17.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

ALTER TABLE IF EXISTS ONLY public.withdraw_requests DROP CONSTRAINT IF EXISTS withdraw_requests_account_id_fkey;
ALTER TABLE IF EXISTS ONLY public.wallets DROP CONSTRAINT IF EXISTS wallets_account_id_fkey;
ALTER TABLE IF EXISTS ONLY public.transactions DROP CONSTRAINT IF EXISTS transactions_wallet_id_fkey;
ALTER TABLE IF EXISTS ONLY public.service_tasks DROP CONSTRAINT IF EXISTS service_tasks_order_id_fkey;
ALTER TABLE IF EXISTS ONLY public.resources DROP CONSTRAINT IF EXISTS resources_variant_id_fkey;
ALTER TABLE IF EXISTS ONLY public.resources DROP CONSTRAINT IF EXISTS resources_seller_id_fkey;
ALTER TABLE IF EXISTS ONLY public.provider_health DROP CONSTRAINT IF EXISTS provider_health_provider_id_fkey;
ALTER TABLE IF EXISTS ONLY public.products DROP CONSTRAINT IF EXISTS products_seller_id_fkey;
ALTER TABLE IF EXISTS ONLY public.products DROP CONSTRAINT IF EXISTS products_category_id_fkey;
ALTER TABLE IF EXISTS ONLY public.product_variants DROP CONSTRAINT IF EXISTS product_variants_product_id_fkey;
ALTER TABLE IF EXISTS ONLY public.orders DROP CONSTRAINT IF EXISTS orders_variant_id_fkey;
ALTER TABLE IF EXISTS ONLY public.orders DROP CONSTRAINT IF EXISTS orders_seller_id_fkey;
ALTER TABLE IF EXISTS ONLY public.orders DROP CONSTRAINT IF EXISTS orders_product_id_fkey;
ALTER TABLE IF EXISTS ONLY public.orders DROP CONSTRAINT IF EXISTS orders_buyer_id_fkey;
ALTER TABLE IF EXISTS ONLY public.resources DROP CONSTRAINT IF EXISTS fk_resources_provider;
ALTER TABLE IF EXISTS ONLY public.resources DROP CONSTRAINT IF EXISTS fk_resources_order;
ALTER TABLE IF EXISTS ONLY public.providers DROP CONSTRAINT IF EXISTS fk_providers_fallback;
ALTER TABLE IF EXISTS ONLY public.products DROP CONSTRAINT IF EXISTS fk_products_provider;
ALTER TABLE IF EXISTS ONLY public.disputes DROP CONSTRAINT IF EXISTS disputes_order_id_fkey;
ALTER TABLE IF EXISTS ONLY public.disputes DROP CONSTRAINT IF EXISTS disputes_buyer_id_fkey;
ALTER TABLE IF EXISTS ONLY public.categories DROP CONSTRAINT IF EXISTS categories_parent_id_fkey;
DROP INDEX IF EXISTS public.ix_log_entries_request_id;
DROP INDEX IF EXISTS public.ix_log_entries_job_id;
ALTER TABLE IF EXISTS ONLY public.withdraw_requests DROP CONSTRAINT IF EXISTS withdraw_requests_pkey;
ALTER TABLE IF EXISTS ONLY public.wallets DROP CONSTRAINT IF EXISTS wallets_pkey;
ALTER TABLE IF EXISTS ONLY public.wallets DROP CONSTRAINT IF EXISTS wallets_account_id_key;
ALTER TABLE IF EXISTS ONLY public.transactions DROP CONSTRAINT IF EXISTS transactions_pkey;
ALTER TABLE IF EXISTS ONLY public.service_tasks DROP CONSTRAINT IF EXISTS service_tasks_pkey;
ALTER TABLE IF EXISTS ONLY public.seller_applications DROP CONSTRAINT IF EXISTS seller_applications_pkey;
ALTER TABLE IF EXISTS ONLY public.resources DROP CONSTRAINT IF EXISTS resources_pkey;
ALTER TABLE IF EXISTS ONLY public.providers DROP CONSTRAINT IF EXISTS providers_pkey;
ALTER TABLE IF EXISTS ONLY public.provider_health DROP CONSTRAINT IF EXISTS provider_health_pkey;
ALTER TABLE IF EXISTS ONLY public.products DROP CONSTRAINT IF EXISTS products_pkey;
ALTER TABLE IF EXISTS ONLY public.product_variants DROP CONSTRAINT IF EXISTS product_variants_pkey;
ALTER TABLE IF EXISTS ONLY public.pricing_configs DROP CONSTRAINT IF EXISTS pricing_configs_service_type_key;
ALTER TABLE IF EXISTS ONLY public.pricing_configs DROP CONSTRAINT IF EXISTS pricing_configs_pkey;
ALTER TABLE IF EXISTS ONLY public.orders DROP CONSTRAINT IF EXISTS orders_pkey;
ALTER TABLE IF EXISTS ONLY public.log_entries DROP CONSTRAINT IF EXISTS log_entries_pkey;
ALTER TABLE IF EXISTS ONLY public.disputes DROP CONSTRAINT IF EXISTS disputes_pkey;
ALTER TABLE IF EXISTS ONLY public.disputes DROP CONSTRAINT IF EXISTS disputes_order_id_key;
ALTER TABLE IF EXISTS ONLY public.categories DROP CONSTRAINT IF EXISTS categories_slug_key;
ALTER TABLE IF EXISTS ONLY public.categories DROP CONSTRAINT IF EXISTS categories_pkey;
ALTER TABLE IF EXISTS ONLY public.alerts DROP CONSTRAINT IF EXISTS alerts_pkey;
ALTER TABLE IF EXISTS ONLY public.alembic_version DROP CONSTRAINT IF EXISTS alembic_version_pkc;
ALTER TABLE IF EXISTS ONLY public.accounts DROP CONSTRAINT IF EXISTS accounts_pkey;
ALTER TABLE IF EXISTS ONLY public.accounts DROP CONSTRAINT IF EXISTS accounts_email_key;
ALTER TABLE IF EXISTS public.withdraw_requests ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.wallets ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.transactions ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.service_tasks ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.seller_applications ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.resources ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.providers ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.provider_health ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.products ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.product_variants ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.pricing_configs ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.orders ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.log_entries ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.disputes ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.categories ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.alerts ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.accounts ALTER COLUMN id DROP DEFAULT;
DROP SEQUENCE IF EXISTS public.withdraw_requests_id_seq;
DROP TABLE IF EXISTS public.withdraw_requests;
DROP SEQUENCE IF EXISTS public.wallets_id_seq;
DROP TABLE IF EXISTS public.wallets;
DROP SEQUENCE IF EXISTS public.transactions_id_seq;
DROP TABLE IF EXISTS public.transactions;
DROP SEQUENCE IF EXISTS public.service_tasks_id_seq;
DROP TABLE IF EXISTS public.service_tasks;
DROP SEQUENCE IF EXISTS public.seller_applications_id_seq;
DROP TABLE IF EXISTS public.seller_applications;
DROP SEQUENCE IF EXISTS public.resources_id_seq;
DROP TABLE IF EXISTS public.resources;
DROP SEQUENCE IF EXISTS public.providers_id_seq;
DROP TABLE IF EXISTS public.providers;
DROP SEQUENCE IF EXISTS public.provider_health_id_seq;
DROP TABLE IF EXISTS public.provider_health;
DROP SEQUENCE IF EXISTS public.products_id_seq;
DROP TABLE IF EXISTS public.products;
DROP SEQUENCE IF EXISTS public.product_variants_id_seq;
DROP TABLE IF EXISTS public.product_variants;
DROP SEQUENCE IF EXISTS public.pricing_configs_id_seq;
DROP TABLE IF EXISTS public.pricing_configs;
DROP SEQUENCE IF EXISTS public.orders_id_seq;
DROP TABLE IF EXISTS public.orders;
DROP SEQUENCE IF EXISTS public.log_entries_id_seq;
DROP TABLE IF EXISTS public.log_entries;
DROP SEQUENCE IF EXISTS public.disputes_id_seq;
DROP TABLE IF EXISTS public.disputes;
DROP SEQUENCE IF EXISTS public.categories_id_seq;
DROP TABLE IF EXISTS public.categories;
DROP SEQUENCE IF EXISTS public.alerts_id_seq;
DROP TABLE IF EXISTS public.alerts;
DROP TABLE IF EXISTS public.alembic_version;
DROP SEQUENCE IF EXISTS public.accounts_id_seq;
DROP TABLE IF EXISTS public.accounts;
DROP TYPE IF EXISTS public.withdrawstatus;
DROP TYPE IF EXISTS public.transactiontype;
DROP TYPE IF EXISTS public.servicetaskstatus;
DROP TYPE IF EXISTS public.resourcestatus;
DROP TYPE IF EXISTS public.productstatus;
DROP TYPE IF EXISTS public.orderstatus;
DROP TYPE IF EXISTS public.disputestatus;
DROP TYPE IF EXISTS public.deliverymode;
DROP TYPE IF EXISTS public.applicationstatus;
-- *not* dropping schema, since initdb creates it
--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- *not* creating schema, since initdb creates it


--
-- Name: applicationstatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.applicationstatus AS ENUM (
    'pending',
    'approved',
    'rejected'
);


--
-- Name: deliverymode; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.deliverymode AS ENUM (
    'instant',
    'manual'
);


--
-- Name: disputestatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.disputestatus AS ENUM (
    'open',
    'resolved_refund',
    'resolved_reject'
);


--
-- Name: orderstatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.orderstatus AS ENUM (
    'pending',
    'processing',
    'delivered',
    'completed',
    'disputed',
    'refunded',
    'cancelled'
);


--
-- Name: productstatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.productstatus AS ENUM (
    'draft',
    'active',
    'paused',
    'suspended'
);


--
-- Name: resourcestatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.resourcestatus AS ENUM (
    'available',
    'assigned',
    'expired',
    'error'
);


--
-- Name: servicetaskstatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.servicetaskstatus AS ENUM (
    'pending',
    'assigned',
    'processing',
    'completed',
    'failed'
);


--
-- Name: transactiontype; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.transactiontype AS ENUM (
    'topup',
    'purchase_hold',
    'purchase_release',
    'platform_fee',
    'withdraw',
    'refund'
);


--
-- Name: withdrawstatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.withdrawstatus AS ENUM (
    'pending',
    'approved',
    'rejected'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts (
    id integer NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    roles character varying[] NOT NULL,
    is_active boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.accounts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: accounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.accounts_id_seq OWNED BY public.accounts.id;


--
-- Name: alembic_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alembic_version (
    version_num character varying(32) NOT NULL
);


--
-- Name: alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alerts (
    id integer NOT NULL,
    type character varying(100) NOT NULL,
    severity character varying(50) NOT NULL,
    target_type character varying(50) NOT NULL,
    target_id integer NOT NULL,
    message text NOT NULL,
    is_active boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.alerts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.alerts_id_seq OWNED BY public.alerts.id;


--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    slug character varying(100) NOT NULL,
    icon character varying(255),
    parent_id integer,
    sort_order integer NOT NULL,
    is_active boolean NOT NULL
);


--
-- Name: categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.categories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.categories_id_seq OWNED BY public.categories.id;


--
-- Name: disputes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.disputes (
    id integer NOT NULL,
    order_id integer NOT NULL,
    buyer_id integer NOT NULL,
    reason text NOT NULL,
    status public.disputestatus NOT NULL,
    admin_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    seller_note text
);


--
-- Name: disputes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.disputes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: disputes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.disputes_id_seq OWNED BY public.disputes.id;


--
-- Name: log_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.log_entries (
    id integer NOT NULL,
    service character varying(50) NOT NULL,
    level character varying(20) NOT NULL,
    request_id character varying(36),
    job_id character varying(36),
    message text NOT NULL,
    metadata json,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: log_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.log_entries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: log_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.log_entries_id_seq OWNED BY public.log_entries.id;


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id integer NOT NULL,
    buyer_id integer NOT NULL,
    seller_id integer NOT NULL,
    variant_id integer,
    quantity integer NOT NULL,
    total_amount integer NOT NULL,
    status public.orderstatus NOT NULL,
    escrow_expires_at timestamp with time zone,
    delivered_data text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    product_id integer
);


--
-- Name: orders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.orders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.orders_id_seq OWNED BY public.orders.id;


--
-- Name: pricing_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_configs (
    id integer NOT NULL,
    service_type character varying(50) NOT NULL,
    strategy character varying(50) NOT NULL,
    params json NOT NULL,
    is_active boolean DEFAULT true,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: pricing_configs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pricing_configs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pricing_configs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pricing_configs_id_seq OWNED BY public.pricing_configs.id;


--
-- Name: product_variants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_variants (
    id integer NOT NULL,
    product_id integer NOT NULL,
    name character varying(255) NOT NULL,
    price integer NOT NULL,
    delivery_mode public.deliverymode NOT NULL,
    sla_hours integer NOT NULL,
    sort_order integer NOT NULL,
    is_active boolean NOT NULL,
    duration_days integer
);


--
-- Name: product_variants_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.product_variants_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_variants_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.product_variants_id_seq OWNED BY public.product_variants.id;


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id integer NOT NULL,
    seller_id integer NOT NULL,
    category_id integer NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    images json,
    escrow_days integer NOT NULL,
    status public.productstatus NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    service_type character varying(50) DEFAULT 'other'::character varying,
    features json,
    specs json,
    warranty_text text,
    highlight_text text,
    sold_count integer DEFAULT 0 NOT NULL,
    rating_avg double precision,
    rating_count integer DEFAULT 0 NOT NULL,
    provider_id integer,
    pricing_strategy character varying(50),
    pricing_params jsonb
);


--
-- Name: products_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.products_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: products_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.products_id_seq OWNED BY public.products.id;


--
-- Name: provider_health; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_health (
    id integer NOT NULL,
    provider_id integer NOT NULL,
    checked_at timestamp with time zone DEFAULT now() NOT NULL,
    latency_ms integer,
    success_rate double precision NOT NULL,
    status character varying(50) NOT NULL
);


--
-- Name: provider_health_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.provider_health_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: provider_health_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.provider_health_id_seq OWNED BY public.provider_health.id;


--
-- Name: providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.providers (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    type character varying(100) NOT NULL,
    config json NOT NULL,
    priority integer NOT NULL,
    is_active boolean NOT NULL,
    quality_score double precision,
    adapter_type character varying(50) DEFAULT 'mock'::character varying,
    pricing_strategy character varying(50) DEFAULT 'fixed'::character varying,
    fallback_provider_id integer
);


--
-- Name: providers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.providers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: providers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.providers_id_seq OWNED BY public.providers.id;


--
-- Name: resources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resources (
    id integer NOT NULL,
    variant_id integer NOT NULL,
    seller_id integer NOT NULL,
    status public.resourcestatus NOT NULL,
    data text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    order_id integer,
    assigned_at timestamp with time zone,
    provider_id integer
);


--
-- Name: resources_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.resources_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: resources_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.resources_id_seq OWNED BY public.resources.id;


--
-- Name: seller_applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seller_applications (
    id integer NOT NULL,
    account_id integer NOT NULL,
    business_name character varying(255) NOT NULL,
    description character varying(1000),
    contact character varying(255),
    status public.applicationstatus NOT NULL,
    reject_reason character varying(500),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: seller_applications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seller_applications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seller_applications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.seller_applications_id_seq OWNED BY public.seller_applications.id;


--
-- Name: service_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_tasks (
    id integer NOT NULL,
    order_id integer NOT NULL,
    platform character varying(50) NOT NULL,
    target_url text NOT NULL,
    status public.servicetaskstatus DEFAULT 'pending'::public.servicetaskstatus,
    assignee character varying(100),
    result_data text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: service_tasks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.service_tasks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: service_tasks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.service_tasks_id_seq OWNED BY public.service_tasks.id;


--
-- Name: transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transactions (
    id integer NOT NULL,
    wallet_id integer NOT NULL,
    type public.transactiontype NOT NULL,
    amount integer NOT NULL,
    description text,
    reference_id character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.transactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.transactions_id_seq OWNED BY public.transactions.id;


--
-- Name: wallets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallets (
    id integer NOT NULL,
    account_id integer NOT NULL,
    balance integer NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: wallets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wallets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wallets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wallets_id_seq OWNED BY public.wallets.id;


--
-- Name: withdraw_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.withdraw_requests (
    id integer NOT NULL,
    account_id integer NOT NULL,
    amount integer NOT NULL,
    status public.withdrawstatus NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: withdraw_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.withdraw_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: withdraw_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.withdraw_requests_id_seq OWNED BY public.withdraw_requests.id;


--
-- Name: accounts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts ALTER COLUMN id SET DEFAULT nextval('public.accounts_id_seq'::regclass);


--
-- Name: alerts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts ALTER COLUMN id SET DEFAULT nextval('public.alerts_id_seq'::regclass);


--
-- Name: categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories ALTER COLUMN id SET DEFAULT nextval('public.categories_id_seq'::regclass);


--
-- Name: disputes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputes ALTER COLUMN id SET DEFAULT nextval('public.disputes_id_seq'::regclass);


--
-- Name: log_entries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.log_entries ALTER COLUMN id SET DEFAULT nextval('public.log_entries_id_seq'::regclass);


--
-- Name: orders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders ALTER COLUMN id SET DEFAULT nextval('public.orders_id_seq'::regclass);


--
-- Name: pricing_configs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_configs ALTER COLUMN id SET DEFAULT nextval('public.pricing_configs_id_seq'::regclass);


--
-- Name: product_variants id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants ALTER COLUMN id SET DEFAULT nextval('public.product_variants_id_seq'::regclass);


--
-- Name: products id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products ALTER COLUMN id SET DEFAULT nextval('public.products_id_seq'::regclass);


--
-- Name: provider_health id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_health ALTER COLUMN id SET DEFAULT nextval('public.provider_health_id_seq'::regclass);


--
-- Name: providers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.providers ALTER COLUMN id SET DEFAULT nextval('public.providers_id_seq'::regclass);


--
-- Name: resources id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resources ALTER COLUMN id SET DEFAULT nextval('public.resources_id_seq'::regclass);


--
-- Name: seller_applications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_applications ALTER COLUMN id SET DEFAULT nextval('public.seller_applications_id_seq'::regclass);


--
-- Name: service_tasks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_tasks ALTER COLUMN id SET DEFAULT nextval('public.service_tasks_id_seq'::regclass);


--
-- Name: transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions ALTER COLUMN id SET DEFAULT nextval('public.transactions_id_seq'::regclass);


--
-- Name: wallets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallets ALTER COLUMN id SET DEFAULT nextval('public.wallets_id_seq'::regclass);


--
-- Name: withdraw_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.withdraw_requests ALTER COLUMN id SET DEFAULT nextval('public.withdraw_requests_id_seq'::regclass);


--
-- Data for Name: accounts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.accounts (id, email, password_hash, roles, is_active, created_at, updated_at) FROM stdin;
3	buyer@dxtrade.example.com	$2b$12$VrrITN04uaj14NgZeQNbLuPyg2vL1Ljy3IHYYZVU1WFwqgUD2HSIm	{buyer}	t	2026-06-22 02:34:07.819077+00	2026-06-22 02:34:07.819077+00
2	seller@dxtrade.example.com	$2b$12$EEWsSZD78vghe7uT8WdzC.xYAGOiw65oMjEnsphxEsdXqYy21P/tu	{buyer,seller}	t	2026-06-22 02:34:07.356719+00	2026-06-22 02:34:07.356719+00
1	admin@dxtrade.example.com	$2b$12$69zx52I7YWaNcmCStjznvu8IJQ9tQOWpTY7RVKleO/RLonJAtSeuq	{buyer,admin,seller}	t	2026-06-22 02:34:07.005761+00	2026-06-22 02:34:07.005761+00
\.


--
-- Data for Name: alembic_version; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.alembic_version (version_num) FROM stdin;
h1c2d3e4f5g6
\.


--
-- Data for Name: alerts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.alerts (id, type, severity, target_type, target_id, message, is_active, created_at) FROM stdin;
1	sla_breach	warning	seller	2	Order 9 cancelled: SLA exceeded	t	2026-06-23 03:40:52.53437+00
2	resource_error	warning	seller	2	Resource 78 marked as error	t	2026-06-23 09:32:23.184676+00
3	resource_error	warning	seller	2	Resource 79 marked as error	t	2026-06-23 09:32:23.647954+00
4	resource_error	warning	seller	2	Resource 150 marked as error	t	2026-06-23 09:49:55.205127+00
\.


--
-- Data for Name: categories; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.categories (id, name, slug, icon, parent_id, sort_order, is_active) FROM stdin;
1	Mạng xã hội	social	\N	\N	0	t
2	Proxy & VPN	proxies	\N	\N	0	t
3	Cloud & Server	cloud	\N	\N	0	t
4	Thanh toán & Credit	payment	\N	\N	0	t
5	Twitter / X	twitter	\N	1	0	t
6	Telegram	telegram	\N	1	0	t
7	Facebook	facebook	\N	1	0	t
\.


--
-- Data for Name: disputes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.disputes (id, order_id, buyer_id, reason, status, admin_note, created_at, resolved_at, seller_note) FROM stdin;
1	1	1	Khong truy cap duoc	resolved_reject	Đã check vẫn hoạt động	2026-06-22 02:35:58.451115+00	2026-06-22 02:38:48.640015+00	\N
2	8	1	ff	resolved_refund	ok	2026-06-22 03:05:20.682184+00	2026-06-22 03:05:35.361875+00	\N
3	11	1	#11	resolved_reject	—	2026-06-22 05:50:05.535847+00	2026-06-22 05:50:22.054419+00	\N
4	24	1	aaa	resolved_refund	ok	2026-06-23 09:27:41.19104+00	2026-06-23 09:28:23.13578+00	\N
6	27	1	abcdf	resolved_reject	fff	2026-06-24 10:49:36.766825+00	2026-06-24 11:04:59.17781+00	fffff 27
5	7	1	#7	resolved_refund	HT	2026-06-24 10:10:55.036574+00	2026-06-24 11:05:30.112448+00	fff
\.


--
-- Data for Name: log_entries; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.log_entries (id, service, level, request_id, job_id, message, metadata, created_at) FROM stdin;
1	marketplace-svc	info	c806fa50-5195-406d-b77b-5fc0077211a4	\N	Order 1 placed (instant)	{"event": "order_placed", "order_id": 1, "buyer_id": 1, "seller_id": 2, "amount": 18000}	2026-06-22 02:35:24.157405+00
2	marketplace-svc	info	c806fa50-5195-406d-b77b-5fc0077211a4	\N	1 resource(s) assigned to order 1	{"event": "resources_assigned", "order_id": 1, "resource_ids": [12]}	2026-06-22 02:35:24.157405+00
3	marketplace-svc	warning	80e50cf6-d9c5-45a4-aa73-7587d7c9fefd	\N	Dispute opened on order 1	{"event": "dispute_opened", "order_id": 1, "buyer_id": 1}	2026-06-22 02:35:58.451115+00
4	marketplace-svc	info	4dc3111c-e7e6-4a75-8a0a-685a5fbba81e	\N	Order 2 placed (instant)	{"event": "order_placed", "order_id": 2, "buyer_id": 1, "seller_id": 2, "amount": 45000}	2026-06-22 02:36:37.077531+00
5	marketplace-svc	info	4dc3111c-e7e6-4a75-8a0a-685a5fbba81e	\N	1 resource(s) assigned to order 2	{"event": "resources_assigned", "order_id": 2, "resource_ids": [17]}	2026-06-22 02:36:37.077531+00
6	marketplace-svc	info	c1aa6db6-c1be-4239-8e42-f924532d9f59	\N	Order 2 confirmed by buyer	{"event": "order_confirmed", "order_id": 2, "amount": 45000}	2026-06-22 02:37:28.010215+00
7	marketplace-svc	info	6ca2592e-bc62-405d-9048-c36249d74021	\N	Dispute 1 rejected	{"event": "dispute_rejected", "order_id": 1, "amount": 18000}	2026-06-22 02:38:48.634944+00
8	marketplace-svc	info	55184db7-3f71-4bb4-a5d4-02c3b868c278	\N	Order 5 placed (instant)	{"event": "order_placed", "order_id": 5, "buyer_id": 1, "seller_id": 2, "amount": 59000}	2026-06-22 02:48:11.573662+00
9	marketplace-svc	info	55184db7-3f71-4bb4-a5d4-02c3b868c278	\N	1 resource(s) assigned to order 5	{"event": "resources_assigned", "order_id": 5, "resource_ids": [5]}	2026-06-22 02:48:11.573662+00
10	marketplace-svc	info	e25d6423-2fce-4e21-b525-4f0ce5593d2f	\N	Order 6 placed (instant)	{"event": "order_placed", "order_id": 6, "buyer_id": 1, "seller_id": 2, "amount": 25000}	2026-06-22 02:48:52.222541+00
11	marketplace-svc	info	e25d6423-2fce-4e21-b525-4f0ce5593d2f	\N	1 resource(s) assigned to order 6	{"event": "resources_assigned", "order_id": 6, "resource_ids": [1]}	2026-06-22 02:48:52.222541+00
12	marketplace-svc	info	3d6ee54f-706c-42f1-85b1-c6b10ea64445	\N	Order 7 placed (instant)	{"event": "order_placed", "order_id": 7, "buyer_id": 1, "seller_id": 2, "amount": 25000}	2026-06-22 02:53:23.242073+00
13	marketplace-svc	info	3d6ee54f-706c-42f1-85b1-c6b10ea64445	\N	1 resource(s) assigned to order 7	{"event": "resources_assigned", "order_id": 7, "resource_ids": [2]}	2026-06-22 02:53:23.242073+00
14	marketplace-svc	info	f656a921-2155-4c71-80da-d57e0ed6ff20	\N	Order 8 placed (instant)	{"event": "order_placed", "order_id": 8, "buyer_id": 1, "seller_id": 2, "amount": 25000}	2026-06-22 02:53:29.316644+00
15	marketplace-svc	info	f656a921-2155-4c71-80da-d57e0ed6ff20	\N	1 resource(s) assigned to order 8	{"event": "resources_assigned", "order_id": 8, "resource_ids": [3]}	2026-06-22 02:53:29.316644+00
16	marketplace-svc	warning	d85c3e1c-bfef-4c64-a699-c18fda201821	\N	Dispute opened on order 8	{"event": "dispute_opened", "order_id": 8, "buyer_id": 1}	2026-06-22 03:05:20.682184+00
17	marketplace-svc	info	88331a0c-b0f7-408c-9c5a-8fe992db8d41	\N	Dispute 2 refunded	{"event": "dispute_refunded", "order_id": 8, "amount": 25000}	2026-06-22 03:05:35.357595+00
18	marketplace-svc	info	e5d7c884-5f94-4efe-809a-75fbb6e4a1ea	\N	Order 9 placed (manual)	{"event": "order_placed", "order_id": 9, "buyer_id": 1, "seller_id": 2, "amount": 150000}	2026-06-22 03:38:58.572427+00
19	marketplace-svc	info	9032aa0a-32ae-48d6-9555-577e71f124cc	\N	Order 10 placed (instant)	{"event": "order_placed", "order_id": 10, "buyer_id": 3, "seller_id": 2, "amount": 25000}	2026-06-22 04:03:49.978624+00
20	marketplace-svc	info	9032aa0a-32ae-48d6-9555-577e71f124cc	\N	1 resource(s) assigned to order 10	{"event": "resources_assigned", "order_id": 10, "resource_ids": [4]}	2026-06-22 04:03:49.978624+00
21	marketplace-svc	info	6689beac-89f6-42ca-86c3-426d2f65c3f6	\N	Order 11 placed (instant)	{"event": "order_placed", "order_id": 11, "buyer_id": 1, "seller_id": 2, "amount": 18000}	2026-06-22 05:49:56.298873+00
22	marketplace-svc	info	6689beac-89f6-42ca-86c3-426d2f65c3f6	\N	1 resource(s) assigned to order 11	{"event": "resources_assigned", "order_id": 11, "resource_ids": [13]}	2026-06-22 05:49:56.298873+00
23	marketplace-svc	warning	a6e27e26-6593-48b2-8327-6289f489deb7	\N	Dispute opened on order 11	{"event": "dispute_opened", "order_id": 11, "buyer_id": 1}	2026-06-22 05:50:05.535847+00
24	marketplace-svc	info	212c93f2-1584-4dfa-9e03-905dc4e23fa2	\N	Dispute 3 rejected	{"event": "dispute_rejected", "order_id": 11, "amount": 18000}	2026-06-22 05:50:22.049226+00
25	marketplace-svc	warning	\N	a9064b15-def1-4153-9d5b-5e7051238745	Order 9 auto-refunded (SLA breach)	{"event": "sla_refund", "order_id": 9, "seller_id": 2}	2026-06-23 03:40:52.53437+00
26	marketplace-svc	info	91acb659-c125-40e9-96f1-3a4a66426d7f	\N	Order 12 placed (instant)	{"event": "order_placed", "order_id": 12, "buyer_id": 3, "seller_id": 2, "amount": 25000}	2026-06-23 07:22:26.39572+00
27	marketplace-svc	info	91acb659-c125-40e9-96f1-3a4a66426d7f	\N	1 resource(s) assigned to order 12	{"event": "resources_assigned", "order_id": 12, "resource_ids": [81]}	2026-06-23 07:22:26.39572+00
28	marketplace-svc	info	02bbb910-5065-4df3-a82f-27ba9b15999c	\N	Order 12 confirmed by buyer	{"event": "order_confirmed", "order_id": 12, "amount": 25000}	2026-06-23 07:22:26.456128+00
29	marketplace-svc	info	62558cf3-cda8-4fca-a764-14ae46654f12	\N	Order 13 placed (instant)	{"event": "order_placed", "order_id": 13, "buyer_id": 3, "seller_id": 2, "amount": 25000}	2026-06-23 07:22:26.480351+00
30	marketplace-svc	info	62558cf3-cda8-4fca-a764-14ae46654f12	\N	1 resource(s) assigned to order 13	{"event": "resources_assigned", "order_id": 13, "resource_ids": [21]}	2026-06-23 07:22:26.480351+00
31	marketplace-svc	info	b83cebf7-3ecf-4136-813f-0210209d9434	\N	Order 14 placed (instant)	{"event": "order_placed", "order_id": 14, "buyer_id": 3, "seller_id": 2, "amount": 28000}	2026-06-23 07:22:26.502222+00
32	marketplace-svc	info	b83cebf7-3ecf-4136-813f-0210209d9434	\N	1 resource(s) assigned to order 14	{"event": "resources_assigned", "order_id": 14, "resource_ids": [10]}	2026-06-23 07:22:26.502222+00
33	marketplace-svc	info	b44551da-43c0-4d1b-ae4f-4178484fa80e	\N	Order 14 confirmed by buyer	{"event": "order_confirmed", "order_id": 14, "amount": 28000}	2026-06-23 07:22:26.534926+00
34	marketplace-svc	info	cd459f2c-4999-4d67-b0ef-3cd2a795ceb3	\N	Order 15 placed (manual)	{"event": "order_placed", "order_id": 15, "buyer_id": 3, "seller_id": 2, "amount": 15000}	2026-06-23 07:22:26.652172+00
35	marketplace-svc	info	af9dd5ee-27ed-4abc-aec4-743526e0a113	\N	Order 16 placed (instant)	{"event": "order_placed", "order_id": 16, "buyer_id": 3, "seller_id": 2, "amount": 28000}	2026-06-23 07:22:26.680853+00
36	marketplace-svc	info	af9dd5ee-27ed-4abc-aec4-743526e0a113	\N	1 resource(s) assigned to order 16	{"event": "resources_assigned", "order_id": 16, "resource_ids": [30]}	2026-06-23 07:22:26.680853+00
37	marketplace-svc	info	e8c55e44-7b1a-448c-99a3-6dbb95ec5310	\N	Order 16 confirmed by buyer	{"event": "order_confirmed", "order_id": 16, "amount": 28000}	2026-06-23 07:22:26.704256+00
38	marketplace-svc	info	34bc44f4-e460-4780-b2b1-b20e34f1a051	\N	Order 17 placed (manual)	{"event": "order_placed", "order_id": 17, "buyer_id": 3, "seller_id": 2, "amount": 290000}	2026-06-23 07:22:26.743771+00
39	marketplace-svc	info	81269085-358e-4ce1-8c55-67bbd5a1fdbc	\N	Order 18 placed (adapter)	{"event": "order_placed", "order_id": 18, "buyer_id": 3, "seller_id": 2, "amount": 120000}	2026-06-23 07:22:26.769109+00
40	marketplace-svc	info	81269085-358e-4ce1-8c55-67bbd5a1fdbc	\N	Order 18 provisioned via adapter	{"event": "order_provisioned", "order_id": 18, "resource_id": "mock_1e4b0736fdbc"}	2026-06-23 07:22:26.769109+00
41	marketplace-svc	info	27044bca-3e80-4c9b-a6db-f800f7e28fc5	\N	Order 19 placed (adapter)	{"event": "order_placed", "order_id": 19, "buyer_id": 3, "seller_id": 2, "amount": 149625}	2026-06-23 07:22:26.804055+00
42	marketplace-svc	info	27044bca-3e80-4c9b-a6db-f800f7e28fc5	\N	Order 19 provisioned via adapter	{"event": "order_provisioned", "order_id": 19, "resource_id": "mock_416b50d2e436"}	2026-06-23 07:22:26.804055+00
43	marketplace-svc	info	d8d0299d-fac6-4c28-b572-36c4d1773139	\N	Order 20 placed (adapter)	{"event": "order_placed", "order_id": 20, "buyer_id": 3, "seller_id": 2, "amount": 47500}	2026-06-23 07:22:26.83609+00
44	marketplace-svc	info	d8d0299d-fac6-4c28-b572-36c4d1773139	\N	Order 20 provisioned via adapter	{"event": "order_provisioned", "order_id": 20, "resource_id": "mock_d0aaaf4cf286"}	2026-06-23 07:22:26.83609+00
45	marketplace-svc	info	19bf332f-e390-4ff8-82ce-9d3db2471f9d	\N	Order 21 placed (adapter)	{"event": "order_placed", "order_id": 21, "buyer_id": 3, "seller_id": 2, "amount": 1500000}	2026-06-23 07:22:26.862972+00
46	marketplace-svc	info	19bf332f-e390-4ff8-82ce-9d3db2471f9d	\N	Order 21 provisioned via adapter	{"event": "order_provisioned", "order_id": 21, "resource_id": "4,5,6"}	2026-06-23 07:22:26.862972+00
47	marketplace-svc	info	74257b16-307a-43c8-8f2c-e284ea563d81	\N	Order 22 placed (manual)	{"event": "order_placed", "order_id": 22, "buyer_id": 1, "seller_id": 2, "amount": 30000}	2026-06-23 07:22:26.932148+00
48	marketplace-svc	info	bdbdbb3a-ab5d-44a4-9a1e-f76efaf5cd3f	\N	Order 23 placed (adapter)	{"event": "order_placed", "order_id": 23, "buyer_id": 1, "seller_id": 2, "amount": 10000}	2026-06-23 07:28:27.335687+00
49	marketplace-svc	info	bdbdbb3a-ab5d-44a4-9a1e-f76efaf5cd3f	\N	Order 23 provisioned via adapter	{"event": "order_provisioned", "order_id": 23, "resource_id": "mock_783ca58b5d5a"}	2026-06-23 07:28:27.335687+00
50	marketplace-svc	info	5888f12a-7ba7-4ceb-8f25-892be338a434	\N	Order 23 confirmed by buyer	{"event": "order_confirmed", "order_id": 23, "amount": 10000}	2026-06-23 07:28:41.894206+00
51	marketplace-svc	info	5457bb22-5ada-44f4-8def-214d5397af5f	\N	Order 24 placed (adapter)	{"event": "order_placed", "order_id": 24, "buyer_id": 1, "seller_id": 2, "amount": 750000}	2026-06-23 07:29:34.250708+00
52	marketplace-svc	info	5457bb22-5ada-44f4-8def-214d5397af5f	\N	Order 24 provisioned via adapter	{"event": "order_provisioned", "order_id": 24, "resource_id": "7"}	2026-06-23 07:29:34.250708+00
53	marketplace-svc	warning	42752499-572a-4859-8192-eb83907fc586	\N	Dispute opened on order 24	{"event": "dispute_opened", "order_id": 24, "buyer_id": 1}	2026-06-23 09:27:41.19104+00
54	marketplace-svc	info	bd4adf1e-ce7b-4652-be35-fbc2971d9c75	\N	Dispute 4 refunded	{"event": "dispute_refunded", "order_id": 24, "amount": 750000}	2026-06-23 09:28:23.127868+00
55	marketplace-svc	info	53c80b57-a9e4-4ebd-acf9-cd18e7c94997	\N	Order 17 delivered manually	{"event": "order_delivered_manual", "order_id": 17}	2026-06-23 10:07:00.465533+00
56	marketplace-svc	info	9cf185fd-87ca-473c-81fc-1f985c8e0939	\N	Order 25 placed (instant)	{"event": "order_placed", "order_id": 25, "buyer_id": 3, "seller_id": 2, "amount": 18000}	2026-06-24 04:15:10.888693+00
57	marketplace-svc	info	9cf185fd-87ca-473c-81fc-1f985c8e0939	\N	1 resource(s) assigned to order 25	{"event": "resources_assigned", "order_id": 25, "resource_ids": [14]}	2026-06-24 04:15:10.888693+00
58	marketplace-svc	info	a28d4bd5-862d-42f0-86b2-75bffc7099d9	\N	Order 26 placed (adapter)	{"event": "order_placed", "order_id": 26, "buyer_id": 3, "seller_id": 2, "amount": 15750}	2026-06-24 04:17:11.21847+00
59	marketplace-svc	info	a28d4bd5-862d-42f0-86b2-75bffc7099d9	\N	Order 26 provisioned via adapter	{"event": "order_provisioned", "order_id": 26, "resource_id": "mock_32d709fb718f"}	2026-06-24 04:17:11.21847+00
60	marketplace-svc	warning	3166ea61-ea70-45d9-ae4b-a8a8880b944d	\N	Dispute opened on order 7	{"event": "dispute_opened", "order_id": 7, "buyer_id": 1}	2026-06-24 10:10:55.036574+00
61	marketplace-svc	info	5cd8ff28-0058-484a-9744-29c8481f14fe	\N	Order 27 placed (instant)	{"event": "order_placed", "order_id": 27, "buyer_id": 1, "seller_id": 2, "amount": 35000}	2026-06-24 10:49:24.268298+00
62	marketplace-svc	info	5cd8ff28-0058-484a-9744-29c8481f14fe	\N	1 resource(s) assigned to order 27	{"event": "resources_assigned", "order_id": 27, "resource_ids": [7]}	2026-06-24 10:49:24.268298+00
63	marketplace-svc	warning	1bae6fba-6cd0-4434-9148-7292902af5f3	\N	Dispute opened on order 27	{"event": "dispute_opened", "order_id": 27, "buyer_id": 1}	2026-06-24 10:49:36.766825+00
64	marketplace-svc	info	a38a6190-33de-4778-964e-b25e0e362486	\N	Seller responded to dispute 5	{"event": "dispute_seller_responded", "order_id": 7, "seller_id": 2}	2026-06-24 10:54:27.312873+00
65	marketplace-svc	info	8a277320-0ca0-4356-8879-e2c0e9a5b089	\N	Seller responded to dispute 6	{"event": "dispute_seller_responded", "order_id": 27, "seller_id": 2}	2026-06-24 11:04:35.213221+00
66	marketplace-svc	info	3742976b-ec58-44da-8112-c8c90924befc	\N	Dispute 6 rejected	{"event": "dispute_rejected", "order_id": 27, "amount": 35000}	2026-06-24 11:04:59.173268+00
67	marketplace-svc	info	67a5dc2d-1406-41e4-a090-e7eef1dae73f	\N	Dispute 5 refunded	{"event": "dispute_refunded", "order_id": 7, "amount": 25000}	2026-06-24 11:05:30.105046+00
68	marketplace-svc	info	\N	aba88c56-11ca-4266-864e-42c0798d73e1	Escrow released for order 5	{"event": "escrow_released", "order_id": 5, "amount": 59000}	2026-06-25 03:09:43.267046+00
69	marketplace-svc	info	\N	aba88c56-11ca-4266-864e-42c0798d73e1	Escrow released for order 6	{"event": "escrow_released", "order_id": 6, "amount": 25000}	2026-06-25 03:09:43.267046+00
70	marketplace-svc	info	\N	cd17bab7-349b-4e5d-bc3d-3ae801eaf43f	Escrow released for order 10	{"event": "escrow_released", "order_id": 10, "amount": 25000}	2026-06-25 04:09:43.266647+00
71	marketplace-svc	info	\N	a113ffc0-576d-404d-9a6c-2547f9abee61	Escrow released for order 13	{"event": "escrow_released", "order_id": 13, "amount": 25000}	2026-06-26 07:46:43.854889+00
72	marketplace-svc	info	\N	a113ffc0-576d-404d-9a6c-2547f9abee61	Escrow released for order 18	{"event": "escrow_released", "order_id": 18, "amount": 120000}	2026-06-26 07:46:43.854889+00
73	marketplace-svc	info	\N	a113ffc0-576d-404d-9a6c-2547f9abee61	Escrow released for order 19	{"event": "escrow_released", "order_id": 19, "amount": 149625}	2026-06-26 07:46:43.854889+00
74	marketplace-svc	info	\N	a113ffc0-576d-404d-9a6c-2547f9abee61	Escrow released for order 20	{"event": "escrow_released", "order_id": 20, "amount": 47500}	2026-06-26 07:46:43.854889+00
75	marketplace-svc	info	\N	a113ffc0-576d-404d-9a6c-2547f9abee61	Escrow released for order 21	{"event": "escrow_released", "order_id": 21, "amount": 1500000}	2026-06-26 07:46:43.854889+00
76	marketplace-svc	info	\N	cd9851ec-0196-4571-8cbb-33c099991e72	Escrow released for order 17	{"event": "escrow_released", "order_id": 17, "amount": 290000}	2026-06-26 10:21:57.233014+00
77	marketplace-svc	info	\N	addbd177-c972-48ae-a4ec-0649c38b77e0	Escrow released for order 25	{"event": "escrow_released", "order_id": 25, "amount": 18000}	2026-06-29 02:46:52.633744+00
78	marketplace-svc	info	\N	addbd177-c972-48ae-a4ec-0649c38b77e0	Escrow released for order 26	{"event": "escrow_released", "order_id": 26, "amount": 15750}	2026-06-29 02:46:52.633744+00
\.


--
-- Data for Name: orders; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.orders (id, buyer_id, seller_id, variant_id, quantity, total_amount, status, escrow_expires_at, delivered_data, created_at, updated_at, product_id) FROM stdin;
7	1	2	1	1	25000	refunded	2026-06-25 02:53:23.246771+00	tw2|pass2|mail2@ex.com|cookie2	2026-06-22 02:53:23.242073+00	2026-06-24 11:05:30.105046+00	\N
5	1	2	2	1	59000	completed	2026-06-25 02:48:11.577225+00	tw2fa1|pass|2fa_key|mail@ex.com	2026-06-22 02:48:11.573662+00	2026-06-25 03:09:43.267046+00	\N
6	1	2	1	1	25000	completed	2026-06-25 02:48:52.226333+00	tw1|pass1|mail1@ex.com|cookie1	2026-06-22 02:48:52.222541+00	2026-06-25 03:09:43.267046+00	\N
2	1	2	9	1	45000	completed	2026-06-25 02:36:37.081329+00	tga1|+1xxx|session_old1	2026-06-22 02:36:37.077531+00	2026-06-22 02:37:28.010215+00	\N
1	1	2	8	1	18000	completed	2026-06-25 02:35:24.163157+00	tg1|+84xxx|session_data1	2026-06-22 02:35:24.157405+00	2026-06-22 02:38:48.634944+00	\N
10	3	2	1	1	25000	completed	2026-06-25 04:03:49.986447+00	tw4|pass4|mail4@ex.com|cookie4	2026-06-22 04:03:49.978624+00	2026-06-25 04:09:43.266647+00	\N
13	3	2	21	1	25000	completed	2026-06-26 07:22:26.484514+00	tw1|pass1|mail1@ex.com|cookie1	2026-06-23 07:22:26.480351+00	2026-06-26 07:46:43.854889+00	\N
18	3	2	\N	1	120000	completed	2026-06-26 07:22:26.787573+00	103.45.232.86:8080:px_user_b3b87aae:px_pass_aa904a3b	2026-06-23 07:22:26.769109+00	2026-06-26 07:46:43.854889+00	4
8	1	2	1	1	25000	refunded	2026-06-25 02:53:29.320141+00	tw3|pass3|mail3@ex.com|cookie3	2026-06-22 02:53:29.316644+00	2026-06-22 03:05:35.357595+00	\N
19	3	2	\N	1	149625	completed	2026-06-26 07:22:26.81867+00	103.45.50.185:8080:px_user_ec9795d1:px_pass_9730c054	2026-06-23 07:22:26.804055+00	2026-06-26 07:46:43.854889+00	4
20	3	2	\N	1	47500	completed	2026-06-26 07:22:26.846361+00	px_sk_live_f43ea6b642604864a42452f688250172	2026-06-23 07:22:26.83609+00	2026-06-26 07:46:43.854889+00	11
11	1	2	8	1	18000	completed	2026-06-25 05:49:56.303051+00	tg2|+84xxx|session_data2	2026-06-22 05:49:56.298873+00	2026-06-22 05:50:22.049226+00	\N
9	1	2	15	1	150000	cancelled	\N	\N	2026-06-22 03:38:58.572427+00	2026-06-23 03:40:52.53437+00	\N
21	3	2	\N	1	1500000	completed	2026-06-26 07:22:26.8833+00	4,5,6	2026-06-23 07:22:26.862972+00	2026-06-26 07:46:43.854889+00	12
12	3	2	1	1	25000	completed	2026-06-26 07:22:26.401792+00	seed_resource_1_0|data|extra	2026-06-23 07:22:26.39572+00	2026-06-23 07:22:26.456128+00	\N
17	3	2	49	1	290000	completed	2026-06-26 10:07:00.469169+00	fff	2026-06-23 07:22:26.743771+00	2026-06-26 10:21:57.233014+00	\N
14	3	2	5	1	28000	completed	2026-06-26 07:22:26.509735+00	fb4|pass|mail@svmail.com|cookie	2026-06-23 07:22:26.502222+00	2026-06-23 07:22:26.534926+00	\N
25	3	2	8	1	18000	completed	2026-06-27 04:15:10.910546+00	tg3|+84xxx|session_data3	2026-06-24 04:15:10.888693+00	2026-06-29 02:46:52.633744+00	\N
16	3	2	25	1	28000	completed	2026-06-26 07:22:26.685202+00	fb4|pass|mail@svmail.com|cookie	2026-06-23 07:22:26.680853+00	2026-06-23 07:22:26.704256+00	\N
26	3	2	\N	1	15750	completed	2026-06-27 04:17:11.261304+00	103.45.88.239:8080:px_user_ea42220b:px_pass_704acadb	2026-06-24 04:17:11.21847+00	2026-06-29 02:46:52.633744+00	4
23	1	2	\N	1	10000	completed	2026-06-26 07:28:27.357398+00	px_sk_live_c7895f72265e4f34a2c853d249507c2b	2026-06-23 07:28:27.335687+00	2026-06-23 07:28:41.894206+00	11
22	1	2	43	2	30000	processing	\N	\N	2026-06-23 07:22:26.932148+00	2026-06-23 07:43:20.024476+00	\N
24	1	2	\N	1	750000	refunded	2026-06-26 07:29:34.287479+00	7	2026-06-23 07:29:34.250708+00	2026-06-23 09:28:23.127868+00	12
15	3	2	43	1	15000	processing	\N	\N	2026-06-23 07:22:26.652172+00	2026-06-23 09:36:17.460574+00	\N
27	1	2	4	1	35000	completed	2026-06-27 10:49:24.278968+00	fb1|pass|2fa_key|mail1@hotmail.com|cookie1	2026-06-24 10:49:24.268298+00	2026-06-24 11:04:59.173268+00	\N
\.


--
-- Data for Name: pricing_configs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.pricing_configs (id, service_type, strategy, params, is_active, updated_at) FROM stdin;
1	account	fixed	{}	t	2026-06-23 07:07:19.293067+00
2	token	fixed	{}	t	2026-06-23 07:07:19.300751+00
3	payment	fixed	{}	t	2026-06-23 07:07:19.305059+00
4	proxy	config	{"type_mult": {"datacenter": 1.0, "residential_static": 1.6, "residential_rotating": 1.2}, "base_price": 75000, "network_mult": {"fpt": 0.9, "vnpt": 0.85, "viettel": 1.0}, "volume_tiers": [{"min_qty": 5, "discount": 0.05}, {"min_qty": 20, "discount": 0.1}], "duration_options": [{"days": 7, "label": "7 ngày"}, {"days": 15, "label": "15 ngày"}, {"days": 30, "label": "30 ngày"}]}	t	2026-06-23 07:07:19.307574+00
5	endpoint	credit	{"packages": [{"size": 1000, "label": "1.000 requests"}, {"size": 5000, "label": "5.000 requests"}, {"size": 10000, "label": "10.000 requests"}], "credit_price": 10, "volume_tiers": [{"min_qty": 5000, "discount": 0.05}, {"min_qty": 10000, "discount": 0.1}]}	t	2026-06-23 07:07:19.309918+00
6	takedown	task	{"base_price": 500000, "volume_tiers": [{"min_qty": 5, "discount": 0.05}, {"min_qty": 20, "discount": 0.1}], "platform_mult": {"tiktok": 1.2, "youtube": 1.5, "facebook": 1.0, "instagram": 1.0}}	t	2026-06-23 07:07:19.3131+00
7	cloud	config	{"base_price": 150000, "plan_options": [{"key": "basic", "label": "Basic — 2 vCPU / 2GB", "multiplier": 1.0}, {"key": "standard", "label": "Standard — 4 vCPU / 4GB", "multiplier": 1.87}, {"key": "pro", "label": "Pro — 8 vCPU / 16GB", "multiplier": 4.33}], "volume_tiers": [], "duration_options": [{"label": "1 tháng", "months": 1, "multiplier": 1.0}, {"label": "3 tháng", "months": 3, "multiplier": 3.0}, {"label": "6 tháng", "months": 6, "multiplier": 5.5}, {"label": "12 tháng", "months": 12, "multiplier": 10.0}]}	t	2026-06-23 07:07:19.315385+00
\.


--
-- Data for Name: product_variants; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.product_variants (id, product_id, name, price, delivery_mode, sla_hours, sort_order, is_active, duration_days) FROM stdin;
1	1	Email + cookies	25000	instant	24	0	t	\N
2	1	Full 2FA + email	59000	instant	24	0	t	\N
3	1	Đặt sỉ theo yêu cầu (50+)	290000	manual	24	0	t	\N
4	2	Clone Việt 5-30 Posts | 30-1000 BB | REG 6.2025 | Avatar | Hotmail | Full 2FA	35000	instant	24	0	t	\N
5	2	ACC Name Việt cổ | UID 10000xxx | Mail SVMail | No2FA	28000	instant	24	0	t	\N
6	2	ACC Việt cổ | 10-50 bạn bè | Hotmail Trust	42000	manual	24	0	t	\N
7	2	ACC Việt cổ nhiều bài viết UID 1000 | 0-1000 BB | 2010-2023 | Hotmail+MailKP+2FA	85000	manual	24	0	t	\N
8	3	Session + JSON	18000	instant	24	0	t	\N
9	3	Cổ 1 năm, không spam	45000	instant	24	0	t	\N
10	3	Bulk 100+ (theo yêu cầu)	15000	manual	24	0	t	\N
11	4	Proxy tĩnh HTTP/SOCKS5 dân cư VN | Viettel/FPT/VNPT | Unlimited Band	120000	manual	24	0	t	\N
12	4	Proxy tĩnh HTTP/SOCKS5 dân cư VN | Viettel/FPT/VNPT | Unlimited Band | 7 ngày	75000	manual	24	0	t	\N
13	4	Proxy tĩnh HTTP/SOCKS5 dân cư VN | Viettel/FPT/VNPT | Unlimited Band | 15 ngày	100000	manual	24	0	t	\N
14	4	Proxy tĩnh HTTP/SOCKS5 dân cư VN | Viettel/FPT/VNPT | Unlimited Band | 30 ngày	180000	manual	24	0	t	\N
15	5	Basic — 2 vCPU / 2GB RAM / 40GB SSD	150000	manual	24	0	t	\N
16	5	Standard — 4 vCPU / 4GB RAM / 80GB SSD	280000	manual	24	0	t	\N
17	5	Pro — 8 vCPU / 16GB RAM / 200GB SSD	650000	manual	24	0	t	\N
18	6	Visa ảo 10 USD	280000	instant	24	0	t	\N
19	6	Visa ảo 50 USD	1350000	instant	24	0	t	\N
20	6	Visa ảo custom (theo yêu cầu)	0	manual	24	0	t	\N
21	7	Email + cookies	25000	instant	24	0	t	\N
22	7	Full 2FA + email	59000	instant	24	0	t	\N
23	7	Đặt sỉ theo yêu cầu (50+)	290000	manual	24	0	t	\N
24	8	Clone Việt 5-30 Posts | 30-1000 BB | REG 6.2025 | Avatar | Hotmail | Full 2FA	35000	instant	24	0	t	\N
25	8	ACC Name Việt cổ | UID 10000xxx | Mail SVMail | No2FA	28000	instant	24	0	t	\N
26	8	ACC Việt cổ | 10-50 bạn bè | Hotmail Trust	42000	manual	24	0	t	\N
27	8	ACC Việt cổ nhiều bài viết UID 1000 | 0-1000 BB | 2010-2023 | Hotmail+MailKP+2FA	85000	manual	24	0	t	\N
28	9	Session + JSON	18000	instant	24	0	t	\N
29	9	Cổ 1 năm, không spam	45000	instant	24	0	t	\N
30	9	Bulk 100+ (theo yêu cầu)	15000	manual	24	0	t	\N
31	10	Visa ảo 10 USD	280000	instant	24	0	t	\N
32	10	Visa ảo 50 USD	1350000	instant	24	0	t	\N
33	10	Visa ảo custom (theo yêu cầu)	0	manual	24	0	t	\N
34	13	Email + cookies	25000	instant	24	0	t	\N
35	13	Full 2FA + email	59000	instant	24	0	t	\N
36	13	Đặt sỉ theo yêu cầu (50+)	290000	manual	24	0	t	\N
37	14	Clone Việt 5-30 Posts | 30-1000 BB | REG 6.2025 | Avatar | Hotmail | Full 2FA	35000	instant	24	0	t	\N
38	14	ACC Name Việt cổ | UID 10000xxx | Mail SVMail | No2FA	28000	instant	24	0	t	\N
39	14	ACC Việt cổ | 10-50 bạn bè | Hotmail Trust	42000	manual	24	0	t	\N
40	14	ACC Việt cổ nhiều bài viết UID 1000 | 0-1000 BB | 2010-2023 | Hotmail+MailKP+2FA	85000	manual	24	0	t	\N
41	15	Session + JSON	18000	instant	24	0	t	\N
42	15	Cổ 1 năm, không spam	45000	instant	24	0	t	\N
43	15	Bulk 100+ (theo yêu cầu)	15000	manual	24	0	t	\N
44	16	Visa ảo 10 USD	280000	instant	24	0	t	\N
45	16	Visa ảo 50 USD	1350000	instant	24	0	t	\N
46	16	Visa ảo custom (theo yêu cầu)	0	manual	24	0	t	\N
47	17	Email + cookies	25000	instant	24	0	t	\N
48	17	Full 2FA + email	59000	instant	24	0	t	\N
49	17	Đặt sỉ theo yêu cầu (50+)	290000	manual	24	0	t	\N
50	18	Clone Việt 5-30 Posts | 30-1000 BB | REG 6.2025 | Avatar | Hotmail | Full 2FA	35000	instant	24	0	t	\N
51	18	ACC Name Việt cổ | UID 10000xxx | Mail SVMail | No2FA	28000	instant	24	0	t	\N
52	18	ACC Việt cổ | 10-50 bạn bè | Hotmail Trust	42000	manual	24	0	t	\N
53	18	ACC Việt cổ nhiều bài viết UID 1000 | 0-1000 BB | 2010-2023 | Hotmail+MailKP+2FA	85000	manual	24	0	t	\N
54	19	Session + JSON	18000	instant	24	0	t	\N
55	19	Cổ 1 năm, không spam	45000	instant	24	0	t	\N
56	19	Bulk 100+ (theo yêu cầu)	15000	manual	24	0	t	\N
57	20	Visa ảo 10 USD	280000	instant	24	0	t	\N
58	20	Visa ảo 50 USD	1350000	instant	24	0	t	\N
59	20	Visa ảo custom (theo yêu cầu)	0	manual	24	0	t	\N
61	22	Email + cookies	25000	instant	24	0	t	\N
62	22	Full 2FA + email	59000	instant	24	0	t	\N
63	22	Đặt sỉ theo yêu cầu (50+)	290000	manual	24	0	t	\N
64	23	Clone Việt 5-30 Posts | 30-1000 BB | REG 6.2025 | Avatar | Hotmail | Full 2FA	35000	instant	24	0	t	\N
65	23	ACC Name Việt cổ | UID 10000xxx | Mail SVMail | No2FA	28000	instant	24	0	t	\N
66	23	ACC Việt cổ | 10-50 bạn bè | Hotmail Trust	42000	manual	24	0	t	\N
67	23	ACC Việt cổ nhiều bài viết UID 1000 | 0-1000 BB | 2010-2023 | Hotmail+MailKP+2FA	85000	manual	24	0	t	\N
68	24	Session + JSON	18000	instant	24	0	t	\N
69	24	Cổ 1 năm, không spam	45000	instant	24	0	t	\N
70	24	Bulk 100+ (theo yêu cầu)	15000	manual	24	0	t	\N
71	25	Visa ảo 10 USD	280000	instant	24	0	t	\N
72	25	Visa ảo 50 USD	1350000	instant	24	0	t	\N
73	25	Visa ảo custom (theo yêu cầu)	0	manual	24	0	t	\N
\.


--
-- Data for Name: products; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.products (id, seller_id, category_id, title, description, images, escrow_days, status, created_at, updated_at, service_type, features, specs, warranty_text, highlight_text, sold_count, rating_avg, rating_count, provider_id, pricing_strategy, pricing_params) FROM stdin;
15	2	6	Telegram số ảo — Session + JSON	Tài khoản Telegram đăng ký bằng số ảo, bàn giao kèm session + JSON. Không spam, sẵn sàng sử dụng.	null	3	active	2026-06-23 07:08:03.878504+00	2026-06-23 07:08:03.878504+00	account	["\\u0110\\u0103ng k\\u00fd b\\u1eb1ng s\\u1ed1 \\u1ea3o ch\\u1ea5t l\\u01b0\\u1ee3ng", "B\\u00e0n giao session + JSON file", "Kh\\u00f4ng spam, profile s\\u1ea1ch", "Ph\\u00f9 h\\u1ee3p nu\\u00f4i group, ch\\u1ea1y bot", "T\\u01b0\\u01a1ng th\\u00edch Telethon, Pyrogram"]	{"format": "PHONE | SESSION | JSON", "platform": "Telegram", "type": "S\\u1ed1 \\u1ea3o", "compatibility": "Telethon, Pyrogram, TDLib"}	Bảo hành 48h nếu session không hoạt động.\nKhông bảo hành nếu bị report do spam.	Session sạch — không spam — sẵn sàng sử dụng	521	4.7	203	2	\N	\N
16	2	4	Visa ảo / Thẻ thanh toán quốc tế	Thẻ Visa/Mastercard ảo dùng thanh toán dịch vụ quốc tế. Nạp tiền linh hoạt, dùng ngay.	null	3	active	2026-06-23 07:08:03.98023+00	2026-06-23 07:08:03.98023+00	payment	["Visa/Mastercard \\u1ea3o ch\\u00ednh h\\u00e3ng", "N\\u1ea1p ti\\u1ec1n linh ho\\u1ea1t t\\u1eeb 5 USD", "Thanh to\\u00e1n Google Ads, Facebook Ads, ChatGPT, Netflix...", "Kh\\u00f4ng c\\u1ea7n KYC cho th\\u1ebb < 1000 USD", "C\\u1ea5p ph\\u00e1t t\\u1ee9c th\\u00ec"]	{"type": "Virtual Card", "network": "Visa / Mastercard", "currency": "USD", "min_load": "5 USD", "max_load": "10,000 USD", "kyc": "Kh\\u00f4ng c\\u1ea7n (< 1000 USD)"}	Hoàn tiền nếu thẻ không hoạt động.\nKhông bảo hành nếu bị từ chối do merchant block BIN.	Cấp phát tức thì — Không KYC — Thanh toán mọi nơi	234	4.4	89	2	\N	\N
1	2	5	Twitter cổ 2020+ — Trust cao	Tài khoản Twitter/X cổ từ 2020, đã xác minh email + số điện thoại. Trust score cao, ít bị hạn chế. Phù hợp chạy ads, seeding, automation.	null	3	active	2026-06-22 02:34:09.828164+00	2026-06-22 02:34:09.828164+00	account	["T\\u00e0i kho\\u1ea3n c\\u1ed5 t\\u1eeb 2020, trust score cao", "\\u0110\\u00e3 x\\u00e1c minh email + s\\u1ed1 \\u0111i\\u1ec7n tho\\u1ea1i", "H\\u1ea1n ch\\u1ebf checkpoint th\\u1ea5p", "H\\u1ed7 tr\\u1ee3 nhi\\u1ec1u qu\\u1ed1c gia (US, UK, VN, EU...)", "Anti-detect m\\u1ea1nh \\u2014 ph\\u00f9 h\\u1ee3p automation", "T\\u01b0\\u01a1ng th\\u00edch tool MMO, bot, seeding"]	{"format": "ID | PASS | MAIL | PASS_MAIL | COOKIE | TOKEN", "platform": "Twitter / X", "age": "2020+", "verified": "Email + Phone", "country": "US, UK, VN, EU"}	Hỗ trợ nếu tài khoản lỗi / không đăng nhập được trong 24h đầu.\nKhông bảo hành nếu sử dụng sai cách / spam quá mức.	IP sạch — Giống người thật — Hạn chế checkpoint tối đa	373	4.6	159	2	\N	\N
4	2	2	Proxy dân cư — Trust cao, Anti Detect mạnh	Proxy dân cư (Residential Proxy) giúp bạn ẩn IP thật và sử dụng IP dân cư thật, tăng độ trust và giảm nguy cơ bị detect.	null	3	active	2026-06-22 02:34:11.097539+00	2026-06-22 02:34:11.097539+00	proxy	["IP t\\u1eeb m\\u1ea1ng d\\u00e2n c\\u01b0 th\\u1eadt (ISP)", "Trust cao \\u2014 h\\u1ea1n ch\\u1ebf checkpoint / kho\\u00e1 t\\u00e0i kho\\u1ea3n", "H\\u1ed7 tr\\u1ee3 nhi\\u1ec1u qu\\u1ed1c gia (US, UK, VN, EU...)", "Anti detect m\\u1ea1nh \\u2014 ph\\u00f9 h\\u1ee3p automation", "\\u0110\\u1ed5i IP linh ho\\u1ea1t theo qu\\u1ed1c gia", "K\\u1ebft n\\u1ed1i \\u1ed5n \\u0111\\u1ecbnh \\u2014 t\\u1ed1c \\u0111\\u1ed9 t\\u1ed1t", "T\\u01b0\\u01a1ng th\\u00edch tool MMO, bot, automation"]	{"format": "DOMAIN : PORT : USERNAME : PASS\\nho\\u1eb7c IP : PORT : USERNAME : PASS", "protocol": "HTTP/SOCKS5", "provider": "Viettel/FPT/VNPT", "bandwidth": "Unlimited Band", "countries": "195+ qu\\u1ed1c gia", "uptime": "99.9%"}	Hỗ trợ nếu proxy lỗi / không kết nối được.\nKhông bảo hành nếu sử dụng sai cách / spam quá mức.	IP sạch — Giống người thật — Hạn chế checkpoint tối đa	892	4.8	412	3	config	{"type_mult": {"datacenter": 1.0, "residential_static": 1.6, "residential_rotating": 1.2}, "base_price": 75000, "network_mult": {"fpt": 0.9, "vnpt": 0.85, "viettel": 1.0}, "volume_tiers": [{"min_qty": 5, "discount": 0.05}, {"min_qty": 20, "discount": 0.1}], "duration_options": [{"days": 7, "label": "7 ngày"}, {"days": 15, "label": "15 ngày"}, {"days": 30, "label": "30 ngày"}]}
2	2	7	Facebook Clone Việt cổ	Tài khoản Facebook Clone Việt cổ, đã qua thời gian nuôi, có bài viết và bạn bè. Phù hợp chạy ads, seeding, reg acc số lượng lớn.	null	3	active	2026-06-22 02:34:10.47683+00	2026-06-22 02:34:10.47683+00	account	["Clone Vi\\u1ec7t 5-30 posts, 30-1000 b\\u1ea1n b\\u00e8", "REG t\\u1eeb 6.2025, avatar + cover \\u0111\\u1ea7y \\u0111\\u1ee7", "Hotmail trust, full 2FA", "Ph\\u00f9 h\\u1ee3p nu\\u00f4i t\\u00e0i kho\\u1ea3n, ch\\u1ea1y ads", "Bypass limit, tr\\u00e1nh block IP", "T\\u01b0\\u01a1ng th\\u00edch tool MMO, seeding"]	{"format": "ID | PASS | 2FA | MAIL | PASS_MAIL | COOKIE | TOKEN", "platform": "Facebook", "type": "Clone Vi\\u1ec7t c\\u1ed5", "friends": "30-1000", "posts": "5-30"}	Hỗ trợ nếu tài khoản checkpoint / die trong 24h đầu.\nĐọc kĩ mô tả và lưu ý trước khi mua hàng.	Clone Việt chất lượng — avatar + cover — bạn bè thật	170	4.5	108	2	\N	\N
3	2	6	Telegram số ảo — Session + JSON	Tài khoản Telegram đăng ký bằng số ảo, bàn giao kèm session + JSON. Không spam, sẵn sàng sử dụng.	null	3	active	2026-06-22 02:34:10.828225+00	2026-06-22 02:34:10.828225+00	account	["\\u0110\\u0103ng k\\u00fd b\\u1eb1ng s\\u1ed1 \\u1ea3o ch\\u1ea5t l\\u01b0\\u1ee3ng", "B\\u00e0n giao session + JSON file", "Kh\\u00f4ng spam, profile s\\u1ea1ch", "Ph\\u00f9 h\\u1ee3p nu\\u00f4i group, ch\\u1ea1y bot", "T\\u01b0\\u01a1ng th\\u00edch Telethon, Pyrogram"]	{"format": "PHONE | SESSION | JSON", "platform": "Telegram", "type": "S\\u1ed1 \\u1ea3o", "compatibility": "Telethon, Pyrogram, TDLib"}	Bảo hành 48h nếu session không hoạt động.\nKhông bảo hành nếu bị report do spam.	Session sạch — không spam — sẵn sàng sử dụng	521	4.7	203	2	\N	\N
8	2	7	Facebook Clone Việt cổ	Tài khoản Facebook Clone Việt cổ, đã qua thời gian nuôi, có bài viết và bạn bè. Phù hợp chạy ads, seeding, reg acc số lượng lớn.	null	3	active	2026-06-23 07:07:18.506918+00	2026-06-23 07:07:18.506918+00	account	["Clone Vi\\u1ec7t 5-30 posts, 30-1000 b\\u1ea1n b\\u00e8", "REG t\\u1eeb 6.2025, avatar + cover \\u0111\\u1ea7y \\u0111\\u1ee7", "Hotmail trust, full 2FA", "Ph\\u00f9 h\\u1ee3p nu\\u00f4i t\\u00e0i kho\\u1ea3n, ch\\u1ea1y ads", "Bypass limit, tr\\u00e1nh block IP", "T\\u01b0\\u01a1ng th\\u00edch tool MMO, seeding"]	{"format": "ID | PASS | 2FA | MAIL | PASS_MAIL | COOKIE | TOKEN", "platform": "Facebook", "type": "Clone Vi\\u1ec7t c\\u1ed5", "friends": "30-1000", "posts": "5-30"}	Hỗ trợ nếu tài khoản checkpoint / die trong 24h đầu.\nĐọc kĩ mô tả và lưu ý trước khi mua hàng.	Clone Việt chất lượng — avatar + cover — bạn bè thật	170	4.5	108	2	\N	\N
5	2	3	VPS Cloud KVM — SSD NVMe	VPS Cloud hiệu năng cao, SSD NVMe, uptime 99.99%. Phù hợp chạy bot, tool, web server.	null	3	active	2026-06-22 02:34:11.336798+00	2026-06-22 02:34:11.336798+00	cloud	["CPU Intel Xeon / AMD EPYC", "SSD NVMe t\\u1ed1c \\u0111\\u1ed9 cao", "Bandwidth 1Gbps unmetered", "Uptime 99.99% SLA", "Root access \\u0111\\u1ea7y \\u0111\\u1ee7", "H\\u1ed7 tr\\u1ee3 nhi\\u1ec1u OS (Ubuntu, CentOS, Debian, Windows)", "Backup t\\u1ef1 \\u0111\\u1ed9ng h\\u00e0ng ng\\u00e0y"]	{"cpu": "2-8 vCPU", "ram": "2-16 GB", "storage": "40-200 GB SSD NVMe", "bandwidth": "1Gbps Unmetered", "location": "VN, SG, US, EU", "os": "Ubuntu, CentOS, Debian, Windows"}	SLA uptime 99.99%. Hoàn tiền nếu downtime vượt SLA.\nHỗ trợ kỹ thuật 24/7 qua ticket.	NVMe tốc độ cao — Root access — Backup tự động	156	4.9	67	3	config	{"base_price": 150000, "plan_options": [{"key": "basic", "label": "Basic — 2 vCPU / 2GB", "multiplier": 1.0}, {"key": "standard", "label": "Standard — 4 vCPU / 4GB", "multiplier": 1.87}, {"key": "pro", "label": "Pro — 8 vCPU / 16GB", "multiplier": 4.33}], "volume_tiers": [], "duration_options": [{"label": "1 tháng", "months": 1, "multiplier": 1.0}, {"label": "3 tháng", "months": 3, "multiplier": 3.0}, {"label": "6 tháng", "months": 6, "multiplier": 5.5}, {"label": "12 tháng", "months": 12, "multiplier": 10.0}]}
6	2	4	Visa ảo / Thẻ thanh toán quốc tế	Thẻ Visa/Mastercard ảo dùng thanh toán dịch vụ quốc tế. Nạp tiền linh hoạt, dùng ngay.	null	1	paused	2026-06-22 02:34:11.688649+00	2026-06-22 03:18:09.24099+00	payment	["Visa/Mastercard \\u1ea3o ch\\u00ednh h\\u00e3ng", "N\\u1ea1p ti\\u1ec1n linh ho\\u1ea1t t\\u1eeb 5 USD", "Thanh to\\u00e1n Google Ads, Facebook Ads, ChatGPT, Netflix...", "Kh\\u00f4ng c\\u1ea7n KYC cho th\\u1ebb < 1000 USD", "C\\u1ea5p ph\\u00e1t t\\u1ee9c th\\u00ec"]	{"type": "Virtual Card", "network": "Visa / Mastercard", "currency": "USD", "min_load": "5 USD", "max_load": "10,000 USD", "kyc": "Kh\\u00f4ng c\\u1ea7n (< 1000 USD)"}	Hoàn tiền nếu thẻ không hoạt động.\nKhông bảo hành nếu bị từ chối do merchant block BIN.	Cấp phát tức thì — Không KYC — Thanh toán mọi nơi	234	4.4	89	2	\N	\N
7	2	5	Twitter cổ 2020+ — Trust cao	Tài khoản Twitter/X cổ từ 2020, đã xác minh email + số điện thoại. Trust score cao, ít bị hạn chế. Phù hợp chạy ads, seeding, automation.	null	3	active	2026-06-23 07:07:18.22423+00	2026-06-23 07:07:18.22423+00	account	["T\\u00e0i kho\\u1ea3n c\\u1ed5 t\\u1eeb 2020, trust score cao", "\\u0110\\u00e3 x\\u00e1c minh email + s\\u1ed1 \\u0111i\\u1ec7n tho\\u1ea1i", "H\\u1ea1n ch\\u1ebf checkpoint th\\u1ea5p", "H\\u1ed7 tr\\u1ee3 nhi\\u1ec1u qu\\u1ed1c gia (US, UK, VN, EU...)", "Anti-detect m\\u1ea1nh \\u2014 ph\\u00f9 h\\u1ee3p automation", "T\\u01b0\\u01a1ng th\\u00edch tool MMO, bot, seeding"]	{"format": "ID | PASS | MAIL | PASS_MAIL | COOKIE | TOKEN", "platform": "Twitter / X", "age": "2020+", "verified": "Email + Phone", "country": "US, UK, VN, EU"}	Hỗ trợ nếu tài khoản lỗi / không đăng nhập được trong 24h đầu.\nKhông bảo hành nếu sử dụng sai cách / spam quá mức.	IP sạch — Giống người thật — Hạn chế checkpoint tối đa	373	4.6	159	2	\N	\N
9	2	6	Telegram số ảo — Session + JSON	Tài khoản Telegram đăng ký bằng số ảo, bàn giao kèm session + JSON. Không spam, sẵn sàng sử dụng.	null	3	active	2026-06-23 07:07:18.663876+00	2026-06-23 07:07:18.663876+00	account	["\\u0110\\u0103ng k\\u00fd b\\u1eb1ng s\\u1ed1 \\u1ea3o ch\\u1ea5t l\\u01b0\\u1ee3ng", "B\\u00e0n giao session + JSON file", "Kh\\u00f4ng spam, profile s\\u1ea1ch", "Ph\\u00f9 h\\u1ee3p nu\\u00f4i group, ch\\u1ea1y bot", "T\\u01b0\\u01a1ng th\\u00edch Telethon, Pyrogram"]	{"format": "PHONE | SESSION | JSON", "platform": "Telegram", "type": "S\\u1ed1 \\u1ea3o", "compatibility": "Telethon, Pyrogram, TDLib"}	Bảo hành 48h nếu session không hoạt động.\nKhông bảo hành nếu bị report do spam.	Session sạch — không spam — sẵn sàng sử dụng	521	4.7	203	2	\N	\N
10	2	4	Visa ảo / Thẻ thanh toán quốc tế	Thẻ Visa/Mastercard ảo dùng thanh toán dịch vụ quốc tế. Nạp tiền linh hoạt, dùng ngay.	null	3	active	2026-06-23 07:07:18.833423+00	2026-06-23 07:07:18.833423+00	payment	["Visa/Mastercard \\u1ea3o ch\\u00ednh h\\u00e3ng", "N\\u1ea1p ti\\u1ec1n linh ho\\u1ea1t t\\u1eeb 5 USD", "Thanh to\\u00e1n Google Ads, Facebook Ads, ChatGPT, Netflix...", "Kh\\u00f4ng c\\u1ea7n KYC cho th\\u1ebb < 1000 USD", "C\\u1ea5p ph\\u00e1t t\\u1ee9c th\\u00ec"]	{"type": "Virtual Card", "network": "Visa / Mastercard", "currency": "USD", "min_load": "5 USD", "max_load": "10,000 USD", "kyc": "Kh\\u00f4ng c\\u1ea7n (< 1000 USD)"}	Hoàn tiền nếu thẻ không hoạt động.\nKhông bảo hành nếu bị từ chối do merchant block BIN.	Cấp phát tức thì — Không KYC — Thanh toán mọi nơi	234	4.4	89	2	\N	\N
13	2	5	Twitter cổ 2020+ — Trust cao	Tài khoản Twitter/X cổ từ 2020, đã xác minh email + số điện thoại. Trust score cao, ít bị hạn chế. Phù hợp chạy ads, seeding, automation.	null	3	active	2026-06-23 07:08:03.664792+00	2026-06-23 07:08:03.664792+00	account	["T\\u00e0i kho\\u1ea3n c\\u1ed5 t\\u1eeb 2020, trust score cao", "\\u0110\\u00e3 x\\u00e1c minh email + s\\u1ed1 \\u0111i\\u1ec7n tho\\u1ea1i", "H\\u1ea1n ch\\u1ebf checkpoint th\\u1ea5p", "H\\u1ed7 tr\\u1ee3 nhi\\u1ec1u qu\\u1ed1c gia (US, UK, VN, EU...)", "Anti-detect m\\u1ea1nh \\u2014 ph\\u00f9 h\\u1ee3p automation", "T\\u01b0\\u01a1ng th\\u00edch tool MMO, bot, seeding"]	{"format": "ID | PASS | MAIL | PASS_MAIL | COOKIE | TOKEN", "platform": "Twitter / X", "age": "2020+", "verified": "Email + Phone", "country": "US, UK, VN, EU"}	Hỗ trợ nếu tài khoản lỗi / không đăng nhập được trong 24h đầu.\nKhông bảo hành nếu sử dụng sai cách / spam quá mức.	IP sạch — Giống người thật — Hạn chế checkpoint tối đa	373	4.6	159	2	\N	\N
14	2	7	Facebook Clone Việt cổ	Tài khoản Facebook Clone Việt cổ, đã qua thời gian nuôi, có bài viết và bạn bè. Phù hợp chạy ads, seeding, reg acc số lượng lớn.	null	3	active	2026-06-23 07:08:03.766822+00	2026-06-23 07:08:03.766822+00	account	["Clone Vi\\u1ec7t 5-30 posts, 30-1000 b\\u1ea1n b\\u00e8", "REG t\\u1eeb 6.2025, avatar + cover \\u0111\\u1ea7y \\u0111\\u1ee7", "Hotmail trust, full 2FA", "Ph\\u00f9 h\\u1ee3p nu\\u00f4i t\\u00e0i kho\\u1ea3n, ch\\u1ea1y ads", "Bypass limit, tr\\u00e1nh block IP", "T\\u01b0\\u01a1ng th\\u00edch tool MMO, seeding"]	{"format": "ID | PASS | 2FA | MAIL | PASS_MAIL | COOKIE | TOKEN", "platform": "Facebook", "type": "Clone Vi\\u1ec7t c\\u1ed5", "friends": "30-1000", "posts": "5-30"}	Hỗ trợ nếu tài khoản checkpoint / die trong 24h đầu.\nĐọc kĩ mô tả và lưu ý trước khi mua hàng.	Clone Việt chất lượng — avatar + cover — bạn bè thật	170	4.5	108	2	\N	\N
12	2	1	Takedown Facebook / TikTok / YouTube	Dịch vụ takedown nội dung vi phạm trên Facebook, TikTok, YouTube. Team xử lý 24-72h. Report tracking real-time.	null	3	active	2026-06-23 07:07:19.373445+00	2026-06-25 04:05:09.369071+00	takedown	["H\\u1ed7 tr\\u1ee3 Facebook, Instagram, TikTok, YouTube", "SLA 24-72h cho m\\u1ed7i URL", "Report tracking real-time", "Team chuy\\u00ean nghi\\u1ec7p, kinh nghi\\u1ec7m 5+ n\\u0103m", "T\\u1ef7 l\\u1ec7 th\\u00e0nh c\\u00f4ng > 85%", "H\\u1ed7 tr\\u1ee3 t\\u01b0 v\\u1ea5n mi\\u1ec5n ph\\u00ed tr\\u01b0\\u1edbc khi \\u0111\\u1eb7t"]	{"platforms": "Facebook, Instagram, TikTok, YouTube", "sla": "24-72h", "success_rate": "> 85%", "tracking": "Real-time qua dashboard"}	Hoàn tiền 100% nếu takedown không thành công.\nKhông hoàn tiền nếu nội dung được phục hồi sau 30 ngày.	Multi-platform — SLA 24-72h — Tracking real-time	143	4.6	51	4	task	{"base_price": 500000, "volume_tiers": [{"min_qty": 5, "discount": 0.1}], "platform_mult": {"Tiktok": 1.5, "Youtube": 1.5, "Facebook": 1.2}}
19	2	6	Telegram số ảo — Session + JSON	Tài khoản Telegram đăng ký bằng số ảo, bàn giao kèm session + JSON. Không spam, sẵn sàng sử dụng.	null	3	active	2026-06-23 07:11:17.27626+00	2026-06-24 06:53:31.645337+00	account	["\\u0110\\u0103ng k\\u00fd b\\u1eb1ng s\\u1ed1 \\u1ea3o ch\\u1ea5t l\\u01b0\\u1ee3ng", "B\\u00e0n giao session + JSON file", "Kh\\u00f4ng spam, profile s\\u1ea1ch", "Ph\\u00f9 h\\u1ee3p nu\\u00f4i group, ch\\u1ea1y bot", "T\\u01b0\\u01a1ng th\\u00edch Telethon, Pyrogram"]	{"format": "PHONE | SESSION | JSON", "platform": "Telegram", "type": "S\\u1ed1 \\u1ea3o", "compatibility": "Telethon, Pyrogram, TDLib"}	Bảo hành 48h nếu session không hoạt động.\nKhông bảo hành nếu bị report do spam.	Session sạch — không spam — sẵn sàng sử dụng	521	4.7	203	2	fixed	\N
17	2	5	Twitter cổ 2020+ — Trust cao	Tài khoản Twitter/X cổ từ 2020, đã xác minh email + số điện thoại. Trust score cao, ít bị hạn chế. Phù hợp chạy ads, seeding, automation.	null	3	active	2026-06-23 07:11:16.887654+00	2026-06-23 07:11:16.887654+00	account	["T\\u00e0i kho\\u1ea3n c\\u1ed5 t\\u1eeb 2020, trust score cao", "\\u0110\\u00e3 x\\u00e1c minh email + s\\u1ed1 \\u0111i\\u1ec7n tho\\u1ea1i", "H\\u1ea1n ch\\u1ebf checkpoint th\\u1ea5p", "H\\u1ed7 tr\\u1ee3 nhi\\u1ec1u qu\\u1ed1c gia (US, UK, VN, EU...)", "Anti-detect m\\u1ea1nh \\u2014 ph\\u00f9 h\\u1ee3p automation", "T\\u01b0\\u01a1ng th\\u00edch tool MMO, bot, seeding"]	{"format": "ID | PASS | MAIL | PASS_MAIL | COOKIE | TOKEN", "platform": "Twitter / X", "age": "2020+", "verified": "Email + Phone", "country": "US, UK, VN, EU"}	Hỗ trợ nếu tài khoản lỗi / không đăng nhập được trong 24h đầu.\nKhông bảo hành nếu sử dụng sai cách / spam quá mức.	IP sạch — Giống người thật — Hạn chế checkpoint tối đa	373	4.6	159	2	\N	\N
18	2	7	Facebook Clone Việt cổ	Tài khoản Facebook Clone Việt cổ, đã qua thời gian nuôi, có bài viết và bạn bè. Phù hợp chạy ads, seeding, reg acc số lượng lớn.	null	3	active	2026-06-23 07:11:17.130273+00	2026-06-23 07:11:17.130273+00	account	["Clone Vi\\u1ec7t 5-30 posts, 30-1000 b\\u1ea1n b\\u00e8", "REG t\\u1eeb 6.2025, avatar + cover \\u0111\\u1ea7y \\u0111\\u1ee7", "Hotmail trust, full 2FA", "Ph\\u00f9 h\\u1ee3p nu\\u00f4i t\\u00e0i kho\\u1ea3n, ch\\u1ea1y ads", "Bypass limit, tr\\u00e1nh block IP", "T\\u01b0\\u01a1ng th\\u00edch tool MMO, seeding"]	{"format": "ID | PASS | 2FA | MAIL | PASS_MAIL | COOKIE | TOKEN", "platform": "Facebook", "type": "Clone Vi\\u1ec7t c\\u1ed5", "friends": "30-1000", "posts": "5-30"}	Hỗ trợ nếu tài khoản checkpoint / die trong 24h đầu.\nĐọc kĩ mô tả và lưu ý trước khi mua hàng.	Clone Việt chất lượng — avatar + cover — bạn bè thật	170	4.5	108	2	\N	\N
20	2	4	Visa ảo / Thẻ thanh toán quốc tế	Thẻ Visa/Mastercard ảo dùng thanh toán dịch vụ quốc tế. Nạp tiền linh hoạt, dùng ngay.	null	3	active	2026-06-23 07:11:17.411631+00	2026-06-23 07:11:17.411631+00	payment	["Visa/Mastercard \\u1ea3o ch\\u00ednh h\\u00e3ng", "N\\u1ea1p ti\\u1ec1n linh ho\\u1ea1t t\\u1eeb 5 USD", "Thanh to\\u00e1n Google Ads, Facebook Ads, ChatGPT, Netflix...", "Kh\\u00f4ng c\\u1ea7n KYC cho th\\u1ebb < 1000 USD", "C\\u1ea5p ph\\u00e1t t\\u1ee9c th\\u00ec"]	{"type": "Virtual Card", "network": "Visa / Mastercard", "currency": "USD", "min_load": "5 USD", "max_load": "10,000 USD", "kyc": "Kh\\u00f4ng c\\u1ea7n (< 1000 USD)"}	Hoàn tiền nếu thẻ không hoạt động.\nKhông bảo hành nếu bị từ chối do merchant block BIN.	Cấp phát tức thì — Không KYC — Thanh toán mọi nơi	234	4.4	89	2	\N	\N
22	2	5	Twitter cổ 2020+ — Trust cao	Tài khoản Twitter/X cổ từ 2020, đã xác minh email + số điện thoại. Trust score cao, ít bị hạn chế. Phù hợp chạy ads, seeding, automation.	null	3	active	2026-06-24 03:33:24.482589+00	2026-06-24 03:33:24.482589+00	account	["T\\u00e0i kho\\u1ea3n c\\u1ed5 t\\u1eeb 2020, trust score cao", "\\u0110\\u00e3 x\\u00e1c minh email + s\\u1ed1 \\u0111i\\u1ec7n tho\\u1ea1i", "H\\u1ea1n ch\\u1ebf checkpoint th\\u1ea5p", "H\\u1ed7 tr\\u1ee3 nhi\\u1ec1u qu\\u1ed1c gia (US, UK, VN, EU...)", "Anti-detect m\\u1ea1nh \\u2014 ph\\u00f9 h\\u1ee3p automation", "T\\u01b0\\u01a1ng th\\u00edch tool MMO, bot, seeding"]	{"format": "ID | PASS | MAIL | PASS_MAIL | COOKIE | TOKEN", "platform": "Twitter / X", "age": "2020+", "verified": "Email + Phone", "country": "US, UK, VN, EU"}	Hỗ trợ nếu tài khoản lỗi / không đăng nhập được trong 24h đầu.\nKhông bảo hành nếu sử dụng sai cách / spam quá mức.	IP sạch — Giống người thật — Hạn chế checkpoint tối đa	373	4.6	159	2	\N	\N
23	2	7	Facebook Clone Việt cổ	Tài khoản Facebook Clone Việt cổ, đã qua thời gian nuôi, có bài viết và bạn bè. Phù hợp chạy ads, seeding, reg acc số lượng lớn.	null	3	active	2026-06-24 03:33:24.730457+00	2026-06-24 03:33:24.730457+00	account	["Clone Vi\\u1ec7t 5-30 posts, 30-1000 b\\u1ea1n b\\u00e8", "REG t\\u1eeb 6.2025, avatar + cover \\u0111\\u1ea7y \\u0111\\u1ee7", "Hotmail trust, full 2FA", "Ph\\u00f9 h\\u1ee3p nu\\u00f4i t\\u00e0i kho\\u1ea3n, ch\\u1ea1y ads", "Bypass limit, tr\\u00e1nh block IP", "T\\u01b0\\u01a1ng th\\u00edch tool MMO, seeding"]	{"format": "ID | PASS | 2FA | MAIL | PASS_MAIL | COOKIE | TOKEN", "platform": "Facebook", "type": "Clone Vi\\u1ec7t c\\u1ed5", "friends": "30-1000", "posts": "5-30"}	Hỗ trợ nếu tài khoản checkpoint / die trong 24h đầu.\nĐọc kĩ mô tả và lưu ý trước khi mua hàng.	Clone Việt chất lượng — avatar + cover — bạn bè thật	170	4.5	108	2	\N	\N
24	2	6	Telegram số ảo — Session + JSON	Tài khoản Telegram đăng ký bằng số ảo, bàn giao kèm session + JSON. Không spam, sẵn sàng sử dụng.	null	3	active	2026-06-24 03:33:24.932366+00	2026-06-24 03:33:24.932366+00	account	["\\u0110\\u0103ng k\\u00fd b\\u1eb1ng s\\u1ed1 \\u1ea3o ch\\u1ea5t l\\u01b0\\u1ee3ng", "B\\u00e0n giao session + JSON file", "Kh\\u00f4ng spam, profile s\\u1ea1ch", "Ph\\u00f9 h\\u1ee3p nu\\u00f4i group, ch\\u1ea1y bot", "T\\u01b0\\u01a1ng th\\u00edch Telethon, Pyrogram"]	{"format": "PHONE | SESSION | JSON", "platform": "Telegram", "type": "S\\u1ed1 \\u1ea3o", "compatibility": "Telethon, Pyrogram, TDLib"}	Bảo hành 48h nếu session không hoạt động.\nKhông bảo hành nếu bị report do spam.	Session sạch — không spam — sẵn sàng sử dụng	521	4.7	203	2	\N	\N
25	2	4	Visa ảo / Thẻ thanh toán quốc tế	Thẻ Visa/Mastercard ảo dùng thanh toán dịch vụ quốc tế. Nạp tiền linh hoạt, dùng ngay.	null	3	active	2026-06-24 03:33:25.121772+00	2026-06-24 03:33:25.121772+00	payment	["Visa/Mastercard \\u1ea3o ch\\u00ednh h\\u00e3ng", "N\\u1ea1p ti\\u1ec1n linh ho\\u1ea1t t\\u1eeb 5 USD", "Thanh to\\u00e1n Google Ads, Facebook Ads, ChatGPT, Netflix...", "Kh\\u00f4ng c\\u1ea7n KYC cho th\\u1ebb < 1000 USD", "C\\u1ea5p ph\\u00e1t t\\u1ee9c th\\u00ec"]	{"type": "Virtual Card", "network": "Visa / Mastercard", "currency": "USD", "min_load": "5 USD", "max_load": "10,000 USD", "kyc": "Kh\\u00f4ng c\\u1ea7n (< 1000 USD)"}	Hoàn tiền nếu thẻ không hoạt động.\nKhông bảo hành nếu bị từ chối do merchant block BIN.	Cấp phát tức thì — Không KYC — Thanh toán mọi nơi	234	4.4	89	2	\N	\N
11	2	3	TikTok Scraper API — Data extraction	API trích xuất dữ liệu TikTok: profile, video, comments, hashtags. Mua gói credit, mỗi request trừ credit. Phù hợp research, marketing, analytics.	null	3	active	2026-06-23 07:07:19.334168+00	2026-06-23 07:07:19.334168+00	endpoint	["API access qua REST + JSON", "Nhi\\u1ec1u endpoint: profile, video, search, hashtag", "Rate limit cao \\u2014 100 req/s", "Credit-based billing \\u2014 ch\\u1ec9 tr\\u1ea3 khi d\\u00f9ng", "SDK Python / Node.js", "Dashboard theo d\\u00f5i usage real-time"]	{"format": "REST API + JSON", "auth": "API Key (Bearer token)", "rate_limit": "100 req/s", "endpoints": "profile, video, search, hashtag, comments", "sdk": "Python, Node.js"}	Credit đã mua không hoàn lại.\nHỗ trợ kỹ thuật qua ticket 24/7.	API mạnh — Credit linh hoạt — SDK sẵn sàng	67	4.5	28	4	credit	{"packages": [{"size": 1000, "label": "1.000 requests"}, {"size": 5000, "label": "5.000 requests"}, {"size": 10000, "label": "10.000 requests"}], "credit_price": 10, "volume_tiers": [{"min_qty": 5000, "discount": 0.05}, {"min_qty": 10000, "discount": 0.1}]}
\.


--
-- Data for Name: provider_health; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.provider_health (id, provider_id, checked_at, latency_ms, success_rate, status) FROM stdin;
1	1	2026-06-23 07:07:52.533589+00	0	1	healthy
2	5	2026-06-23 07:07:52.533589+00	0	1	healthy
3	2	2026-06-23 07:07:52.533589+00	0	1	healthy
4	3	2026-06-23 07:07:52.533589+00	0	1	healthy
5	4	2026-06-23 07:07:52.533589+00	0	1	healthy
6	1	2026-06-23 07:08:52.532771+00	0	1	healthy
7	5	2026-06-23 07:08:52.532771+00	0	1	healthy
8	2	2026-06-23 07:08:52.532771+00	0	1	healthy
9	3	2026-06-23 07:08:52.532771+00	0	1	healthy
10	4	2026-06-23 07:08:52.532771+00	0	1	healthy
11	1	2026-06-23 07:09:52.533298+00	0	1	healthy
12	5	2026-06-23 07:09:52.533298+00	0	1	healthy
13	2	2026-06-23 07:09:52.533298+00	0	1	healthy
14	3	2026-06-23 07:09:52.533298+00	0	1	healthy
15	4	2026-06-23 07:09:52.533298+00	0	1	healthy
16	1	2026-06-23 07:11:10.89346+00	0	1	healthy
17	5	2026-06-23 07:11:10.89346+00	0	1	healthy
18	2	2026-06-23 07:11:10.89346+00	0	1	healthy
19	3	2026-06-23 07:11:10.89346+00	0	1	healthy
20	4	2026-06-23 07:11:10.89346+00	0	1	healthy
21	1	2026-06-23 07:12:10.773818+00	0	1	healthy
22	5	2026-06-23 07:12:10.773818+00	0	1	healthy
23	2	2026-06-23 07:12:10.773818+00	0	1	healthy
24	3	2026-06-23 07:12:10.773818+00	0	1	healthy
25	4	2026-06-23 07:12:10.773818+00	0	1	healthy
26	1	2026-06-23 07:13:10.774276+00	0	1	healthy
27	5	2026-06-23 07:13:10.774276+00	0	1	healthy
28	2	2026-06-23 07:13:10.774276+00	0	1	healthy
29	3	2026-06-23 07:13:10.774276+00	0	1	healthy
30	4	2026-06-23 07:13:10.774276+00	0	1	healthy
31	1	2026-06-23 07:14:10.774567+00	0	1	healthy
32	5	2026-06-23 07:14:10.774567+00	0	1	healthy
33	2	2026-06-23 07:14:10.774567+00	0	1	healthy
34	3	2026-06-23 07:14:10.774567+00	0	1	healthy
35	4	2026-06-23 07:14:10.774567+00	0	1	healthy
36	1	2026-06-23 07:15:10.777625+00	0	1	healthy
37	5	2026-06-23 07:15:10.777625+00	0	1	healthy
38	2	2026-06-23 07:15:10.777625+00	0	1	healthy
39	3	2026-06-23 07:15:10.777625+00	0	1	healthy
40	4	2026-06-23 07:15:10.777625+00	0	1	healthy
41	1	2026-06-23 07:16:10.773518+00	0	1	healthy
42	5	2026-06-23 07:16:10.773518+00	0	1	healthy
43	2	2026-06-23 07:16:10.773518+00	0	1	healthy
44	3	2026-06-23 07:16:10.773518+00	0	1	healthy
45	4	2026-06-23 07:16:10.773518+00	0	1	healthy
46	1	2026-06-23 07:17:10.774041+00	0	1	healthy
47	5	2026-06-23 07:17:10.774041+00	0	1	healthy
48	2	2026-06-23 07:17:10.774041+00	0	1	healthy
49	3	2026-06-23 07:17:10.774041+00	0	1	healthy
50	4	2026-06-23 07:17:10.774041+00	0	1	healthy
51	1	2026-06-23 07:18:10.776462+00	0	1	healthy
52	5	2026-06-23 07:18:10.776462+00	0	1	healthy
53	2	2026-06-23 07:18:10.776462+00	0	1	healthy
54	3	2026-06-23 07:18:10.776462+00	0	1	healthy
55	4	2026-06-23 07:18:10.776462+00	0	1	healthy
56	1	2026-06-23 07:19:10.77346+00	0	1	healthy
57	5	2026-06-23 07:19:10.77346+00	0	1	healthy
58	2	2026-06-23 07:19:10.77346+00	0	1	healthy
59	3	2026-06-23 07:19:10.77346+00	0	1	healthy
60	4	2026-06-23 07:19:10.77346+00	0	1	healthy
61	1	2026-06-23 07:20:10.777253+00	0	1	healthy
62	5	2026-06-23 07:20:10.777253+00	0	1	healthy
63	2	2026-06-23 07:20:10.777253+00	0	1	healthy
64	3	2026-06-23 07:20:10.777253+00	0	1	healthy
65	4	2026-06-23 07:20:10.777253+00	0	1	healthy
66	1	2026-06-23 07:21:10.774778+00	0	1	healthy
67	5	2026-06-23 07:21:10.774778+00	0	1	healthy
68	2	2026-06-23 07:21:10.774778+00	0	1	healthy
69	3	2026-06-23 07:21:10.774778+00	0	1	healthy
70	4	2026-06-23 07:21:10.774778+00	0	1	healthy
71	1	2026-06-23 07:22:10.773677+00	0	1	healthy
72	5	2026-06-23 07:22:10.773677+00	0	1	healthy
73	2	2026-06-23 07:22:10.773677+00	0	1	healthy
74	3	2026-06-23 07:22:10.773677+00	0	1	healthy
75	4	2026-06-23 07:22:10.773677+00	0	1	healthy
76	1	2026-06-23 07:23:23.080551+00	0	1	healthy
77	5	2026-06-23 07:23:23.080551+00	0	1	healthy
78	2	2026-06-23 07:23:23.080551+00	0	1	healthy
79	3	2026-06-23 07:23:23.080551+00	0	1	healthy
80	4	2026-06-23 07:23:23.080551+00	0	1	healthy
81	1	2026-06-23 07:24:23.079846+00	0	1	healthy
82	5	2026-06-23 07:24:23.079846+00	0	1	healthy
83	2	2026-06-23 07:24:23.079846+00	0	1	healthy
84	3	2026-06-23 07:24:23.079846+00	0	1	healthy
85	4	2026-06-23 07:24:23.079846+00	0	1	healthy
86	1	2026-06-23 07:25:23.078263+00	0	1	healthy
87	5	2026-06-23 07:25:23.078263+00	0	1	healthy
88	2	2026-06-23 07:25:23.078263+00	0	1	healthy
89	3	2026-06-23 07:25:23.078263+00	0	1	healthy
90	4	2026-06-23 07:25:23.078263+00	0	1	healthy
91	1	2026-06-23 07:26:23.149879+00	0	1	healthy
92	5	2026-06-23 07:26:23.149879+00	0	1	healthy
93	2	2026-06-23 07:26:23.149879+00	0	1	healthy
94	3	2026-06-23 07:26:23.149879+00	0	1	healthy
95	4	2026-06-23 07:26:23.149879+00	0	1	healthy
96	1	2026-06-23 07:27:23.081014+00	0	1	healthy
97	5	2026-06-23 07:27:23.081014+00	0	1	healthy
98	2	2026-06-23 07:27:23.081014+00	0	1	healthy
99	3	2026-06-23 07:27:23.081014+00	0	1	healthy
100	4	2026-06-23 07:27:23.081014+00	0	1	healthy
101	1	2026-06-23 07:28:23.079467+00	0	1	healthy
102	5	2026-06-23 07:28:23.079467+00	0	1	healthy
103	2	2026-06-23 07:28:23.079467+00	0	1	healthy
104	3	2026-06-23 07:28:23.079467+00	0	1	healthy
105	4	2026-06-23 07:28:23.079467+00	0	1	healthy
106	1	2026-06-23 07:29:23.079363+00	0	1	healthy
107	5	2026-06-23 07:29:23.079363+00	0	1	healthy
108	2	2026-06-23 07:29:23.079363+00	0	1	healthy
109	3	2026-06-23 07:29:23.079363+00	0	1	healthy
110	4	2026-06-23 07:29:23.079363+00	0	1	healthy
111	1	2026-06-23 07:30:23.079819+00	0	1	healthy
112	5	2026-06-23 07:30:23.079819+00	0	1	healthy
113	2	2026-06-23 07:30:23.079819+00	0	1	healthy
114	3	2026-06-23 07:30:23.079819+00	0	1	healthy
115	4	2026-06-23 07:30:23.079819+00	0	1	healthy
116	1	2026-06-23 07:31:23.080261+00	0	1	healthy
117	5	2026-06-23 07:31:23.080261+00	0	1	healthy
118	2	2026-06-23 07:31:23.080261+00	0	1	healthy
119	3	2026-06-23 07:31:23.080261+00	0	1	healthy
120	4	2026-06-23 07:31:23.080261+00	0	1	healthy
121	1	2026-06-23 07:32:23.079937+00	0	1	healthy
122	5	2026-06-23 07:32:23.079937+00	0	1	healthy
123	2	2026-06-23 07:32:23.079937+00	0	1	healthy
124	3	2026-06-23 07:32:23.079937+00	0	1	healthy
125	4	2026-06-23 07:32:23.079937+00	0	1	healthy
126	1	2026-06-23 07:33:23.079922+00	0	1	healthy
127	5	2026-06-23 07:33:23.079922+00	0	1	healthy
128	2	2026-06-23 07:33:23.079922+00	0	1	healthy
129	3	2026-06-23 07:33:23.079922+00	0	1	healthy
130	4	2026-06-23 07:33:23.079922+00	0	1	healthy
1231	1	2026-06-23 12:06:23.081326+00	0	1	healthy
1232	5	2026-06-23 12:06:23.081326+00	0	1	healthy
1233	2	2026-06-23 12:06:23.081326+00	0	1	healthy
1234	3	2026-06-23 12:06:23.081326+00	0	1	healthy
1235	4	2026-06-23 12:06:23.081326+00	0	1	healthy
1271	1	2026-06-23 12:47:23.079399+00	0	1	healthy
1272	5	2026-06-23 12:47:23.079399+00	0	1	healthy
1273	2	2026-06-23 12:47:23.079399+00	0	1	healthy
1274	3	2026-06-23 12:47:23.079399+00	0	1	healthy
1275	4	2026-06-23 12:47:23.079399+00	0	1	healthy
1291	1	2026-06-23 13:11:23.081798+00	0	1	healthy
1292	5	2026-06-23 13:11:23.081798+00	0	1	healthy
1293	2	2026-06-23 13:11:23.081798+00	0	1	healthy
1294	3	2026-06-23 13:11:23.081798+00	0	1	healthy
1295	4	2026-06-23 13:11:23.081798+00	0	1	healthy
1301	1	2026-06-23 13:13:23.078774+00	0	1	healthy
1302	5	2026-06-23 13:13:23.078774+00	0	1	healthy
1303	2	2026-06-23 13:13:23.078774+00	0	1	healthy
1304	3	2026-06-23 13:13:23.078774+00	0	1	healthy
1305	4	2026-06-23 13:13:23.078774+00	0	1	healthy
1316	1	2026-06-23 13:48:23.081666+00	0	1	healthy
1317	5	2026-06-23 13:48:23.081666+00	0	1	healthy
1318	2	2026-06-23 13:48:23.081666+00	0	1	healthy
1319	3	2026-06-23 13:48:23.081666+00	0	1	healthy
1320	4	2026-06-23 13:48:23.081666+00	0	1	healthy
1511	1	2026-06-23 20:31:23.952477+00	0	1	healthy
1512	5	2026-06-23 20:31:23.952477+00	0	1	healthy
1513	2	2026-06-23 20:31:23.952477+00	0	1	healthy
1514	3	2026-06-23 20:31:23.952477+00	0	1	healthy
1515	4	2026-06-23 20:31:23.952477+00	0	1	healthy
1536	1	2026-06-23 23:36:23.081932+00	0	1	healthy
1537	5	2026-06-23 23:36:23.081932+00	0	1	healthy
1538	2	2026-06-23 23:36:23.081932+00	0	1	healthy
1539	3	2026-06-23 23:36:23.081932+00	0	1	healthy
1540	4	2026-06-23 23:36:23.081932+00	0	1	healthy
1546	1	2026-06-24 00:35:23.081418+00	0	1	healthy
1547	5	2026-06-24 00:35:23.081418+00	0	1	healthy
1548	2	2026-06-24 00:35:23.081418+00	0	1	healthy
1549	3	2026-06-24 00:35:23.081418+00	0	1	healthy
1550	4	2026-06-24 00:35:23.081418+00	0	1	healthy
1571	1	2026-06-24 01:44:23.081134+00	0	1	healthy
1572	5	2026-06-24 01:44:23.081134+00	0	1	healthy
1573	2	2026-06-24 01:44:23.081134+00	0	1	healthy
1574	3	2026-06-24 01:44:23.081134+00	0	1	healthy
1575	4	2026-06-24 01:44:23.081134+00	0	1	healthy
1601	1	2026-06-24 01:54:23.079738+00	0	1	healthy
1602	5	2026-06-24 01:54:23.079738+00	0	1	healthy
1603	2	2026-06-24 01:54:23.079738+00	0	1	healthy
1604	3	2026-06-24 01:54:23.079738+00	0	1	healthy
1605	4	2026-06-24 01:54:23.079738+00	0	1	healthy
1641	1	2026-06-24 02:02:23.081202+00	0	1	healthy
1642	5	2026-06-24 02:02:23.081202+00	0	1	healthy
1643	2	2026-06-24 02:02:23.081202+00	0	1	healthy
1644	3	2026-06-24 02:02:23.081202+00	0	1	healthy
1645	4	2026-06-24 02:02:23.081202+00	0	1	healthy
1671	1	2026-06-24 02:08:23.102368+00	0	1	healthy
1672	5	2026-06-24 02:08:23.102368+00	0	1	healthy
1673	2	2026-06-24 02:08:23.102368+00	0	1	healthy
1674	3	2026-06-24 02:08:23.102368+00	0	1	healthy
1675	4	2026-06-24 02:08:23.102368+00	0	1	healthy
1736	1	2026-06-24 02:21:23.080263+00	0	1	healthy
1737	5	2026-06-24 02:21:23.080263+00	0	1	healthy
1738	2	2026-06-24 02:21:23.080263+00	0	1	healthy
1739	3	2026-06-24 02:21:23.080263+00	0	1	healthy
1740	4	2026-06-24 02:21:23.080263+00	0	1	healthy
1926	1	2026-06-24 02:59:23.079297+00	0	1	healthy
1927	5	2026-06-24 02:59:23.079297+00	0	1	healthy
1928	2	2026-06-24 02:59:23.079297+00	0	1	healthy
1929	3	2026-06-24 02:59:23.079297+00	0	1	healthy
1930	4	2026-06-24 02:59:23.079297+00	0	1	healthy
2086	1	2026-06-24 03:34:05.911453+00	0	1	healthy
2087	5	2026-06-24 03:34:05.911453+00	0	1	healthy
2088	2	2026-06-24 03:34:05.911453+00	0	1	healthy
2089	3	2026-06-24 03:34:05.911453+00	0	1	healthy
2090	4	2026-06-24 03:34:05.911453+00	0	1	healthy
2091	1	2026-06-24 03:35:05.908978+00	0	1	healthy
2092	5	2026-06-24 03:35:05.908978+00	0	1	healthy
2093	2	2026-06-24 03:35:05.908978+00	0	1	healthy
2094	3	2026-06-24 03:35:05.908978+00	0	1	healthy
2095	4	2026-06-24 03:35:05.908978+00	0	1	healthy
2096	1	2026-06-24 03:36:05.937782+00	0	1	healthy
2097	5	2026-06-24 03:36:05.937782+00	0	1	healthy
2098	2	2026-06-24 03:36:05.937782+00	0	1	healthy
2099	3	2026-06-24 03:36:05.937782+00	0	1	healthy
2100	4	2026-06-24 03:36:05.937782+00	0	1	healthy
2101	1	2026-06-24 03:37:05.908094+00	0	1	healthy
2102	5	2026-06-24 03:37:05.908094+00	0	1	healthy
2103	2	2026-06-24 03:37:05.908094+00	0	1	healthy
2104	3	2026-06-24 03:37:05.908094+00	0	1	healthy
2105	4	2026-06-24 03:37:05.908094+00	0	1	healthy
2106	1	2026-06-24 03:38:05.911648+00	0	1	healthy
2107	5	2026-06-24 03:38:05.911648+00	0	1	healthy
2108	2	2026-06-24 03:38:05.911648+00	0	1	healthy
2109	3	2026-06-24 03:38:05.911648+00	0	1	healthy
2110	4	2026-06-24 03:38:05.911648+00	0	1	healthy
2111	1	2026-06-24 03:39:05.907438+00	0	1	healthy
2112	5	2026-06-24 03:39:05.907438+00	0	1	healthy
2113	2	2026-06-24 03:39:05.907438+00	0	1	healthy
2114	3	2026-06-24 03:39:05.907438+00	0	1	healthy
2115	4	2026-06-24 03:39:05.907438+00	0	1	healthy
2141	1	2026-06-24 03:46:05.920074+00	0	1	healthy
2142	5	2026-06-24 03:46:05.920074+00	0	1	healthy
2143	2	2026-06-24 03:46:05.920074+00	0	1	healthy
2144	3	2026-06-24 03:46:05.920074+00	0	1	healthy
2145	4	2026-06-24 03:46:05.920074+00	0	1	healthy
2166	1	2026-06-24 03:51:05.908689+00	0	1	healthy
2167	5	2026-06-24 03:51:05.908689+00	0	1	healthy
2168	2	2026-06-24 03:51:05.908689+00	0	1	healthy
2169	3	2026-06-24 03:51:05.908689+00	0	1	healthy
2170	4	2026-06-24 03:51:05.908689+00	0	1	healthy
131	1	2026-06-23 07:34:23.080869+00	0	1	healthy
132	5	2026-06-23 07:34:23.080869+00	0	1	healthy
133	2	2026-06-23 07:34:23.080869+00	0	1	healthy
134	3	2026-06-23 07:34:23.080869+00	0	1	healthy
135	4	2026-06-23 07:34:23.080869+00	0	1	healthy
136	1	2026-06-23 07:35:23.079904+00	0	1	healthy
137	5	2026-06-23 07:35:23.079904+00	0	1	healthy
138	2	2026-06-23 07:35:23.079904+00	0	1	healthy
139	3	2026-06-23 07:35:23.079904+00	0	1	healthy
140	4	2026-06-23 07:35:23.079904+00	0	1	healthy
141	1	2026-06-23 07:36:23.079753+00	0	1	healthy
142	5	2026-06-23 07:36:23.079753+00	0	1	healthy
143	2	2026-06-23 07:36:23.079753+00	0	1	healthy
144	3	2026-06-23 07:36:23.079753+00	0	1	healthy
145	4	2026-06-23 07:36:23.079753+00	0	1	healthy
146	1	2026-06-23 07:37:23.081154+00	0	1	healthy
147	5	2026-06-23 07:37:23.081154+00	0	1	healthy
148	2	2026-06-23 07:37:23.081154+00	0	1	healthy
149	3	2026-06-23 07:37:23.081154+00	0	1	healthy
150	4	2026-06-23 07:37:23.081154+00	0	1	healthy
151	1	2026-06-23 07:38:23.079691+00	0	1	healthy
152	5	2026-06-23 07:38:23.079691+00	0	1	healthy
153	2	2026-06-23 07:38:23.079691+00	0	1	healthy
154	3	2026-06-23 07:38:23.079691+00	0	1	healthy
155	4	2026-06-23 07:38:23.079691+00	0	1	healthy
156	1	2026-06-23 07:39:23.078711+00	0	1	healthy
157	5	2026-06-23 07:39:23.078711+00	0	1	healthy
158	2	2026-06-23 07:39:23.078711+00	0	1	healthy
159	3	2026-06-23 07:39:23.078711+00	0	1	healthy
160	4	2026-06-23 07:39:23.078711+00	0	1	healthy
161	1	2026-06-23 07:40:23.080621+00	0	1	healthy
162	5	2026-06-23 07:40:23.080621+00	0	1	healthy
163	2	2026-06-23 07:40:23.080621+00	0	1	healthy
164	3	2026-06-23 07:40:23.080621+00	0	1	healthy
165	4	2026-06-23 07:40:23.080621+00	0	1	healthy
166	1	2026-06-23 07:41:23.098667+00	0	1	healthy
167	5	2026-06-23 07:41:23.098667+00	0	1	healthy
168	2	2026-06-23 07:41:23.098667+00	0	1	healthy
169	3	2026-06-23 07:41:23.098667+00	0	1	healthy
170	4	2026-06-23 07:41:23.098667+00	0	1	healthy
171	1	2026-06-23 07:42:23.084835+00	0	1	healthy
172	5	2026-06-23 07:42:23.084835+00	0	1	healthy
173	2	2026-06-23 07:42:23.084835+00	0	1	healthy
174	3	2026-06-23 07:42:23.084835+00	0	1	healthy
175	4	2026-06-23 07:42:23.084835+00	0	1	healthy
176	1	2026-06-23 07:43:23.078837+00	0	1	healthy
177	5	2026-06-23 07:43:23.078837+00	0	1	healthy
178	2	2026-06-23 07:43:23.078837+00	0	1	healthy
179	3	2026-06-23 07:43:23.078837+00	0	1	healthy
180	4	2026-06-23 07:43:23.078837+00	0	1	healthy
181	1	2026-06-23 07:44:23.079626+00	0	1	healthy
182	5	2026-06-23 07:44:23.079626+00	0	1	healthy
183	2	2026-06-23 07:44:23.079626+00	0	1	healthy
184	3	2026-06-23 07:44:23.079626+00	0	1	healthy
185	4	2026-06-23 07:44:23.079626+00	0	1	healthy
186	1	2026-06-23 07:45:23.078994+00	0	1	healthy
187	5	2026-06-23 07:45:23.078994+00	0	1	healthy
188	2	2026-06-23 07:45:23.078994+00	0	1	healthy
189	3	2026-06-23 07:45:23.078994+00	0	1	healthy
190	4	2026-06-23 07:45:23.078994+00	0	1	healthy
191	1	2026-06-23 07:46:23.07944+00	0	1	healthy
192	5	2026-06-23 07:46:23.07944+00	0	1	healthy
193	2	2026-06-23 07:46:23.07944+00	0	1	healthy
194	3	2026-06-23 07:46:23.07944+00	0	1	healthy
195	4	2026-06-23 07:46:23.07944+00	0	1	healthy
196	1	2026-06-23 07:47:23.079801+00	0	1	healthy
197	5	2026-06-23 07:47:23.079801+00	0	1	healthy
198	2	2026-06-23 07:47:23.079801+00	0	1	healthy
199	3	2026-06-23 07:47:23.079801+00	0	1	healthy
200	4	2026-06-23 07:47:23.079801+00	0	1	healthy
201	1	2026-06-23 07:48:23.08005+00	0	1	healthy
202	5	2026-06-23 07:48:23.08005+00	0	1	healthy
203	2	2026-06-23 07:48:23.08005+00	0	1	healthy
204	3	2026-06-23 07:48:23.08005+00	0	1	healthy
205	4	2026-06-23 07:48:23.08005+00	0	1	healthy
206	1	2026-06-23 07:49:23.078603+00	0	1	healthy
207	5	2026-06-23 07:49:23.078603+00	0	1	healthy
208	2	2026-06-23 07:49:23.078603+00	0	1	healthy
209	3	2026-06-23 07:49:23.078603+00	0	1	healthy
210	4	2026-06-23 07:49:23.078603+00	0	1	healthy
211	1	2026-06-23 07:50:23.080171+00	0	1	healthy
212	5	2026-06-23 07:50:23.080171+00	0	1	healthy
213	2	2026-06-23 07:50:23.080171+00	0	1	healthy
214	3	2026-06-23 07:50:23.080171+00	0	1	healthy
215	4	2026-06-23 07:50:23.080171+00	0	1	healthy
216	1	2026-06-23 07:51:23.078939+00	0	1	healthy
217	5	2026-06-23 07:51:23.078939+00	0	1	healthy
218	2	2026-06-23 07:51:23.078939+00	0	1	healthy
219	3	2026-06-23 07:51:23.078939+00	0	1	healthy
220	4	2026-06-23 07:51:23.078939+00	0	1	healthy
221	1	2026-06-23 07:52:23.081956+00	0	1	healthy
222	5	2026-06-23 07:52:23.081956+00	0	1	healthy
223	2	2026-06-23 07:52:23.081956+00	0	1	healthy
224	3	2026-06-23 07:52:23.081956+00	0	1	healthy
225	4	2026-06-23 07:52:23.081956+00	0	1	healthy
226	1	2026-06-23 07:53:23.079719+00	0	1	healthy
227	5	2026-06-23 07:53:23.079719+00	0	1	healthy
228	2	2026-06-23 07:53:23.079719+00	0	1	healthy
229	3	2026-06-23 07:53:23.079719+00	0	1	healthy
230	4	2026-06-23 07:53:23.079719+00	0	1	healthy
231	1	2026-06-23 07:54:23.078875+00	0	1	healthy
232	5	2026-06-23 07:54:23.078875+00	0	1	healthy
233	2	2026-06-23 07:54:23.078875+00	0	1	healthy
234	3	2026-06-23 07:54:23.078875+00	0	1	healthy
235	4	2026-06-23 07:54:23.078875+00	0	1	healthy
236	1	2026-06-23 07:55:23.080956+00	0	1	healthy
237	5	2026-06-23 07:55:23.080956+00	0	1	healthy
238	2	2026-06-23 07:55:23.080956+00	0	1	healthy
239	3	2026-06-23 07:55:23.080956+00	0	1	healthy
240	4	2026-06-23 07:55:23.080956+00	0	1	healthy
241	1	2026-06-23 07:56:23.078473+00	0	1	healthy
242	5	2026-06-23 07:56:23.078473+00	0	1	healthy
243	2	2026-06-23 07:56:23.078473+00	0	1	healthy
244	3	2026-06-23 07:56:23.078473+00	0	1	healthy
245	4	2026-06-23 07:56:23.078473+00	0	1	healthy
246	1	2026-06-23 07:57:23.081356+00	0	1	healthy
247	5	2026-06-23 07:57:23.081356+00	0	1	healthy
248	2	2026-06-23 07:57:23.081356+00	0	1	healthy
249	3	2026-06-23 07:57:23.081356+00	0	1	healthy
250	4	2026-06-23 07:57:23.081356+00	0	1	healthy
251	1	2026-06-23 07:58:23.079425+00	0	1	healthy
252	5	2026-06-23 07:58:23.079425+00	0	1	healthy
253	2	2026-06-23 07:58:23.079425+00	0	1	healthy
254	3	2026-06-23 07:58:23.079425+00	0	1	healthy
255	4	2026-06-23 07:58:23.079425+00	0	1	healthy
256	1	2026-06-23 07:59:23.078463+00	0	1	healthy
257	5	2026-06-23 07:59:23.078463+00	0	1	healthy
258	2	2026-06-23 07:59:23.078463+00	0	1	healthy
259	3	2026-06-23 07:59:23.078463+00	0	1	healthy
260	4	2026-06-23 07:59:23.078463+00	0	1	healthy
261	1	2026-06-23 08:00:23.07863+00	0	1	healthy
262	5	2026-06-23 08:00:23.07863+00	0	1	healthy
263	2	2026-06-23 08:00:23.07863+00	0	1	healthy
264	3	2026-06-23 08:00:23.07863+00	0	1	healthy
265	4	2026-06-23 08:00:23.07863+00	0	1	healthy
266	1	2026-06-23 08:01:23.079662+00	0	1	healthy
267	5	2026-06-23 08:01:23.079662+00	0	1	healthy
268	2	2026-06-23 08:01:23.079662+00	0	1	healthy
269	3	2026-06-23 08:01:23.079662+00	0	1	healthy
270	4	2026-06-23 08:01:23.079662+00	0	1	healthy
271	1	2026-06-23 08:02:23.078904+00	0	1	healthy
272	5	2026-06-23 08:02:23.078904+00	0	1	healthy
273	2	2026-06-23 08:02:23.078904+00	0	1	healthy
274	3	2026-06-23 08:02:23.078904+00	0	1	healthy
275	4	2026-06-23 08:02:23.078904+00	0	1	healthy
276	1	2026-06-23 08:03:23.081708+00	0	1	healthy
277	5	2026-06-23 08:03:23.081708+00	0	1	healthy
278	2	2026-06-23 08:03:23.081708+00	0	1	healthy
279	3	2026-06-23 08:03:23.081708+00	0	1	healthy
280	4	2026-06-23 08:03:23.081708+00	0	1	healthy
281	1	2026-06-23 08:04:23.090413+00	0	1	healthy
282	5	2026-06-23 08:04:23.090413+00	0	1	healthy
283	2	2026-06-23 08:04:23.090413+00	0	1	healthy
284	3	2026-06-23 08:04:23.090413+00	0	1	healthy
285	4	2026-06-23 08:04:23.090413+00	0	1	healthy
286	1	2026-06-23 08:08:23.079022+00	0	1	healthy
287	5	2026-06-23 08:08:23.079022+00	0	1	healthy
288	2	2026-06-23 08:08:23.079022+00	0	1	healthy
289	3	2026-06-23 08:08:23.079022+00	0	1	healthy
290	4	2026-06-23 08:08:23.079022+00	0	1	healthy
291	1	2026-06-23 08:09:23.078187+00	0	1	healthy
292	5	2026-06-23 08:09:23.078187+00	0	1	healthy
293	2	2026-06-23 08:09:23.078187+00	0	1	healthy
294	3	2026-06-23 08:09:23.078187+00	0	1	healthy
295	4	2026-06-23 08:09:23.078187+00	0	1	healthy
296	1	2026-06-23 08:10:23.078722+00	0	1	healthy
297	5	2026-06-23 08:10:23.078722+00	0	1	healthy
298	2	2026-06-23 08:10:23.078722+00	0	1	healthy
299	3	2026-06-23 08:10:23.078722+00	0	1	healthy
300	4	2026-06-23 08:10:23.078722+00	0	1	healthy
301	1	2026-06-23 08:11:23.079291+00	0	1	healthy
302	5	2026-06-23 08:11:23.079291+00	0	1	healthy
303	2	2026-06-23 08:11:23.079291+00	0	1	healthy
304	3	2026-06-23 08:11:23.079291+00	0	1	healthy
305	4	2026-06-23 08:11:23.079291+00	0	1	healthy
306	1	2026-06-23 08:12:23.079716+00	0	1	healthy
307	5	2026-06-23 08:12:23.079716+00	0	1	healthy
308	2	2026-06-23 08:12:23.079716+00	0	1	healthy
309	3	2026-06-23 08:12:23.079716+00	0	1	healthy
310	4	2026-06-23 08:12:23.079716+00	0	1	healthy
311	1	2026-06-23 08:13:23.078332+00	0	1	healthy
312	5	2026-06-23 08:13:23.078332+00	0	1	healthy
313	2	2026-06-23 08:13:23.078332+00	0	1	healthy
314	3	2026-06-23 08:13:23.078332+00	0	1	healthy
315	4	2026-06-23 08:13:23.078332+00	0	1	healthy
316	1	2026-06-23 08:14:23.079579+00	0	1	healthy
317	5	2026-06-23 08:14:23.079579+00	0	1	healthy
318	2	2026-06-23 08:14:23.079579+00	0	1	healthy
319	3	2026-06-23 08:14:23.079579+00	0	1	healthy
320	4	2026-06-23 08:14:23.079579+00	0	1	healthy
321	1	2026-06-23 08:15:23.080727+00	0	1	healthy
322	5	2026-06-23 08:15:23.080727+00	0	1	healthy
323	2	2026-06-23 08:15:23.080727+00	0	1	healthy
324	3	2026-06-23 08:15:23.080727+00	0	1	healthy
325	4	2026-06-23 08:15:23.080727+00	0	1	healthy
326	1	2026-06-23 08:16:23.080509+00	0	1	healthy
327	5	2026-06-23 08:16:23.080509+00	0	1	healthy
328	2	2026-06-23 08:16:23.080509+00	0	1	healthy
329	3	2026-06-23 08:16:23.080509+00	0	1	healthy
330	4	2026-06-23 08:16:23.080509+00	0	1	healthy
331	1	2026-06-23 08:17:23.080361+00	0	1	healthy
332	5	2026-06-23 08:17:23.080361+00	0	1	healthy
333	2	2026-06-23 08:17:23.080361+00	0	1	healthy
334	3	2026-06-23 08:17:23.080361+00	0	1	healthy
335	4	2026-06-23 08:17:23.080361+00	0	1	healthy
336	1	2026-06-23 08:18:23.07921+00	0	1	healthy
337	5	2026-06-23 08:18:23.07921+00	0	1	healthy
338	2	2026-06-23 08:18:23.07921+00	0	1	healthy
339	3	2026-06-23 08:18:23.07921+00	0	1	healthy
340	4	2026-06-23 08:18:23.07921+00	0	1	healthy
341	1	2026-06-23 08:19:23.078259+00	0	1	healthy
342	5	2026-06-23 08:19:23.078259+00	0	1	healthy
343	2	2026-06-23 08:19:23.078259+00	0	1	healthy
344	3	2026-06-23 08:19:23.078259+00	0	1	healthy
345	4	2026-06-23 08:19:23.078259+00	0	1	healthy
346	1	2026-06-23 08:20:23.087296+00	0	1	healthy
347	5	2026-06-23 08:20:23.087296+00	0	1	healthy
348	2	2026-06-23 08:20:23.087296+00	0	1	healthy
349	3	2026-06-23 08:20:23.087296+00	0	1	healthy
350	4	2026-06-23 08:20:23.087296+00	0	1	healthy
351	1	2026-06-23 08:21:23.078773+00	0	1	healthy
352	5	2026-06-23 08:21:23.078773+00	0	1	healthy
353	2	2026-06-23 08:21:23.078773+00	0	1	healthy
354	3	2026-06-23 08:21:23.078773+00	0	1	healthy
355	4	2026-06-23 08:21:23.078773+00	0	1	healthy
356	1	2026-06-23 08:22:23.083278+00	0	1	healthy
357	5	2026-06-23 08:22:23.083278+00	0	1	healthy
358	2	2026-06-23 08:22:23.083278+00	0	1	healthy
359	3	2026-06-23 08:22:23.083278+00	0	1	healthy
360	4	2026-06-23 08:22:23.083278+00	0	1	healthy
361	1	2026-06-23 08:23:23.079991+00	0	1	healthy
362	5	2026-06-23 08:23:23.079991+00	0	1	healthy
363	2	2026-06-23 08:23:23.079991+00	0	1	healthy
364	3	2026-06-23 08:23:23.079991+00	0	1	healthy
365	4	2026-06-23 08:23:23.079991+00	0	1	healthy
366	1	2026-06-23 08:24:23.078844+00	0	1	healthy
367	5	2026-06-23 08:24:23.078844+00	0	1	healthy
368	2	2026-06-23 08:24:23.078844+00	0	1	healthy
369	3	2026-06-23 08:24:23.078844+00	0	1	healthy
370	4	2026-06-23 08:24:23.078844+00	0	1	healthy
371	1	2026-06-23 08:25:23.079573+00	0	1	healthy
372	5	2026-06-23 08:25:23.079573+00	0	1	healthy
373	2	2026-06-23 08:25:23.079573+00	0	1	healthy
374	3	2026-06-23 08:25:23.079573+00	0	1	healthy
375	4	2026-06-23 08:25:23.079573+00	0	1	healthy
376	1	2026-06-23 08:26:23.080518+00	0	1	healthy
377	5	2026-06-23 08:26:23.080518+00	0	1	healthy
378	2	2026-06-23 08:26:23.080518+00	0	1	healthy
379	3	2026-06-23 08:26:23.080518+00	0	1	healthy
380	4	2026-06-23 08:26:23.080518+00	0	1	healthy
386	1	2026-06-23 08:28:23.090586+00	0	1	healthy
387	5	2026-06-23 08:28:23.090586+00	0	1	healthy
388	2	2026-06-23 08:28:23.090586+00	0	1	healthy
389	3	2026-06-23 08:28:23.090586+00	0	1	healthy
390	4	2026-06-23 08:28:23.090586+00	0	1	healthy
401	1	2026-06-23 08:31:23.087784+00	0	1	healthy
402	5	2026-06-23 08:31:23.087784+00	0	1	healthy
403	2	2026-06-23 08:31:23.087784+00	0	1	healthy
404	3	2026-06-23 08:31:23.087784+00	0	1	healthy
405	4	2026-06-23 08:31:23.087784+00	0	1	healthy
411	1	2026-06-23 08:33:23.081864+00	0	1	healthy
412	5	2026-06-23 08:33:23.081864+00	0	1	healthy
413	2	2026-06-23 08:33:23.081864+00	0	1	healthy
414	3	2026-06-23 08:33:23.081864+00	0	1	healthy
415	4	2026-06-23 08:33:23.081864+00	0	1	healthy
1236	1	2026-06-23 12:24:23.081386+00	0	1	healthy
1237	5	2026-06-23 12:24:23.081386+00	0	1	healthy
1238	2	2026-06-23 12:24:23.081386+00	0	1	healthy
1239	3	2026-06-23 12:24:23.081386+00	0	1	healthy
1240	4	2026-06-23 12:24:23.081386+00	0	1	healthy
1286	1	2026-06-23 12:50:23.079472+00	0	1	healthy
1287	5	2026-06-23 12:50:23.079472+00	0	1	healthy
1288	2	2026-06-23 12:50:23.079472+00	0	1	healthy
1289	3	2026-06-23 12:50:23.079472+00	0	1	healthy
1290	4	2026-06-23 12:50:23.079472+00	0	1	healthy
1516	1	2026-06-23 21:01:23.081476+00	0	1	healthy
1517	5	2026-06-23 21:01:23.081476+00	0	1	healthy
1518	2	2026-06-23 21:01:23.081476+00	0	1	healthy
1519	3	2026-06-23 21:01:23.081476+00	0	1	healthy
1520	4	2026-06-23 21:01:23.081476+00	0	1	healthy
1551	1	2026-06-24 01:03:23.082465+00	0	1	healthy
1552	5	2026-06-24 01:03:23.082465+00	0	1	healthy
1553	2	2026-06-24 01:03:23.082465+00	0	1	healthy
1554	3	2026-06-24 01:03:23.082465+00	0	1	healthy
1555	4	2026-06-24 01:03:23.082465+00	0	1	healthy
1586	1	2026-06-24 01:51:23.079012+00	0	1	healthy
1587	5	2026-06-24 01:51:23.079012+00	0	1	healthy
1588	2	2026-06-24 01:51:23.079012+00	0	1	healthy
1589	3	2026-06-24 01:51:23.079012+00	0	1	healthy
1590	4	2026-06-24 01:51:23.079012+00	0	1	healthy
1616	1	2026-06-24 01:57:23.081117+00	0	1	healthy
1617	5	2026-06-24 01:57:23.081117+00	0	1	healthy
1618	2	2026-06-24 01:57:23.081117+00	0	1	healthy
1619	3	2026-06-24 01:57:23.081117+00	0	1	healthy
1620	4	2026-06-24 01:57:23.081117+00	0	1	healthy
1646	1	2026-06-24 02:03:23.07956+00	0	1	healthy
1647	5	2026-06-24 02:03:23.07956+00	0	1	healthy
1648	2	2026-06-24 02:03:23.07956+00	0	1	healthy
1649	3	2026-06-24 02:03:23.07956+00	0	1	healthy
1650	4	2026-06-24 02:03:23.07956+00	0	1	healthy
1651	1	2026-06-24 02:04:23.078889+00	0	1	healthy
1652	5	2026-06-24 02:04:23.078889+00	0	1	healthy
1653	2	2026-06-24 02:04:23.078889+00	0	1	healthy
1654	3	2026-06-24 02:04:23.078889+00	0	1	healthy
1655	4	2026-06-24 02:04:23.078889+00	0	1	healthy
1741	1	2026-06-24 02:22:23.081907+00	0	1	healthy
1742	5	2026-06-24 02:22:23.081907+00	0	1	healthy
1743	2	2026-06-24 02:22:23.081907+00	0	1	healthy
1744	3	2026-06-24 02:22:23.081907+00	0	1	healthy
1745	4	2026-06-24 02:22:23.081907+00	0	1	healthy
1756	1	2026-06-24 02:25:23.079862+00	0	1	healthy
1757	5	2026-06-24 02:25:23.079862+00	0	1	healthy
1758	2	2026-06-24 02:25:23.079862+00	0	1	healthy
1759	3	2026-06-24 02:25:23.079862+00	0	1	healthy
1760	4	2026-06-24 02:25:23.079862+00	0	1	healthy
1761	1	2026-06-24 02:26:23.079603+00	0	1	healthy
1762	5	2026-06-24 02:26:23.079603+00	0	1	healthy
1763	2	2026-06-24 02:26:23.079603+00	0	1	healthy
1764	3	2026-06-24 02:26:23.079603+00	0	1	healthy
1765	4	2026-06-24 02:26:23.079603+00	0	1	healthy
1771	1	2026-06-24 02:28:23.079105+00	0	1	healthy
1772	5	2026-06-24 02:28:23.079105+00	0	1	healthy
1773	2	2026-06-24 02:28:23.079105+00	0	1	healthy
1774	3	2026-06-24 02:28:23.079105+00	0	1	healthy
1775	4	2026-06-24 02:28:23.079105+00	0	1	healthy
1936	1	2026-06-24 03:01:23.078279+00	0	1	healthy
1937	5	2026-06-24 03:01:23.078279+00	0	1	healthy
1938	2	2026-06-24 03:01:23.078279+00	0	1	healthy
1939	3	2026-06-24 03:01:23.078279+00	0	1	healthy
1940	4	2026-06-24 03:01:23.078279+00	0	1	healthy
1946	1	2026-06-24 03:03:23.078608+00	0	1	healthy
1947	5	2026-06-24 03:03:23.078608+00	0	1	healthy
1948	2	2026-06-24 03:03:23.078608+00	0	1	healthy
1949	3	2026-06-24 03:03:23.078608+00	0	1	healthy
1950	4	2026-06-24 03:03:23.078608+00	0	1	healthy
1961	1	2026-06-24 03:08:23.088395+00	0	1	healthy
1962	5	2026-06-24 03:08:23.088395+00	0	1	healthy
1963	2	2026-06-24 03:08:23.088395+00	0	1	healthy
1964	3	2026-06-24 03:08:23.088395+00	0	1	healthy
1965	4	2026-06-24 03:08:23.088395+00	0	1	healthy
1966	1	2026-06-24 03:09:23.079031+00	0	1	healthy
1967	5	2026-06-24 03:09:23.079031+00	0	1	healthy
1968	2	2026-06-24 03:09:23.079031+00	0	1	healthy
1969	3	2026-06-24 03:09:23.079031+00	0	1	healthy
1970	4	2026-06-24 03:09:23.079031+00	0	1	healthy
1971	1	2026-06-24 03:10:23.079441+00	0	1	healthy
1972	5	2026-06-24 03:10:23.079441+00	0	1	healthy
1973	2	2026-06-24 03:10:23.079441+00	0	1	healthy
1974	3	2026-06-24 03:10:23.079441+00	0	1	healthy
1975	4	2026-06-24 03:10:23.079441+00	0	1	healthy
1986	1	2026-06-24 03:13:23.078978+00	0	1	healthy
1987	5	2026-06-24 03:13:23.078978+00	0	1	healthy
1988	2	2026-06-24 03:13:23.078978+00	0	1	healthy
1989	3	2026-06-24 03:13:23.078978+00	0	1	healthy
1990	4	2026-06-24 03:13:23.078978+00	0	1	healthy
2026	1	2026-06-24 03:21:23.079898+00	0	1	healthy
2027	5	2026-06-24 03:21:23.079898+00	0	1	healthy
2028	2	2026-06-24 03:21:23.079898+00	0	1	healthy
2029	3	2026-06-24 03:21:23.079898+00	0	1	healthy
2030	4	2026-06-24 03:21:23.079898+00	0	1	healthy
381	1	2026-06-23 08:27:23.085537+00	0	1	healthy
382	5	2026-06-23 08:27:23.085537+00	0	1	healthy
383	2	2026-06-23 08:27:23.085537+00	0	1	healthy
384	3	2026-06-23 08:27:23.085537+00	0	1	healthy
385	4	2026-06-23 08:27:23.085537+00	0	1	healthy
391	1	2026-06-23 08:29:23.080187+00	0	1	healthy
392	5	2026-06-23 08:29:23.080187+00	0	1	healthy
393	2	2026-06-23 08:29:23.080187+00	0	1	healthy
394	3	2026-06-23 08:29:23.080187+00	0	1	healthy
395	4	2026-06-23 08:29:23.080187+00	0	1	healthy
396	1	2026-06-23 08:30:23.079531+00	0	1	healthy
397	5	2026-06-23 08:30:23.079531+00	0	1	healthy
398	2	2026-06-23 08:30:23.079531+00	0	1	healthy
399	3	2026-06-23 08:30:23.079531+00	0	1	healthy
400	4	2026-06-23 08:30:23.079531+00	0	1	healthy
406	1	2026-06-23 08:32:23.097011+00	0	1	healthy
407	5	2026-06-23 08:32:23.097011+00	0	1	healthy
408	2	2026-06-23 08:32:23.097011+00	0	1	healthy
409	3	2026-06-23 08:32:23.097011+00	0	1	healthy
410	4	2026-06-23 08:32:23.097011+00	0	1	healthy
416	1	2026-06-23 08:34:23.079001+00	0	1	healthy
417	5	2026-06-23 08:34:23.079001+00	0	1	healthy
418	2	2026-06-23 08:34:23.079001+00	0	1	healthy
419	3	2026-06-23 08:34:23.079001+00	0	1	healthy
420	4	2026-06-23 08:34:23.079001+00	0	1	healthy
421	1	2026-06-23 08:35:23.08122+00	0	1	healthy
422	5	2026-06-23 08:35:23.08122+00	0	1	healthy
423	2	2026-06-23 08:35:23.08122+00	0	1	healthy
424	3	2026-06-23 08:35:23.08122+00	0	1	healthy
425	4	2026-06-23 08:35:23.08122+00	0	1	healthy
426	1	2026-06-23 08:36:23.079773+00	0	1	healthy
427	5	2026-06-23 08:36:23.079773+00	0	1	healthy
428	2	2026-06-23 08:36:23.079773+00	0	1	healthy
429	3	2026-06-23 08:36:23.079773+00	0	1	healthy
430	4	2026-06-23 08:36:23.079773+00	0	1	healthy
431	1	2026-06-23 08:37:23.082355+00	0	1	healthy
432	5	2026-06-23 08:37:23.082355+00	0	1	healthy
433	2	2026-06-23 08:37:23.082355+00	0	1	healthy
434	3	2026-06-23 08:37:23.082355+00	0	1	healthy
435	4	2026-06-23 08:37:23.082355+00	0	1	healthy
436	1	2026-06-23 08:38:23.100632+00	0	1	healthy
437	5	2026-06-23 08:38:23.100632+00	0	1	healthy
438	2	2026-06-23 08:38:23.100632+00	0	1	healthy
439	3	2026-06-23 08:38:23.100632+00	0	1	healthy
440	4	2026-06-23 08:38:23.100632+00	0	1	healthy
441	1	2026-06-23 08:39:23.082078+00	0	1	healthy
442	5	2026-06-23 08:39:23.082078+00	0	1	healthy
443	2	2026-06-23 08:39:23.082078+00	0	1	healthy
444	3	2026-06-23 08:39:23.082078+00	0	1	healthy
445	4	2026-06-23 08:39:23.082078+00	0	1	healthy
446	1	2026-06-23 08:40:23.079678+00	0	1	healthy
447	5	2026-06-23 08:40:23.079678+00	0	1	healthy
448	2	2026-06-23 08:40:23.079678+00	0	1	healthy
449	3	2026-06-23 08:40:23.079678+00	0	1	healthy
450	4	2026-06-23 08:40:23.079678+00	0	1	healthy
451	1	2026-06-23 08:41:23.082028+00	0	1	healthy
452	5	2026-06-23 08:41:23.082028+00	0	1	healthy
453	2	2026-06-23 08:41:23.082028+00	0	1	healthy
454	3	2026-06-23 08:41:23.082028+00	0	1	healthy
455	4	2026-06-23 08:41:23.082028+00	0	1	healthy
456	1	2026-06-23 08:42:23.081078+00	0	1	healthy
457	5	2026-06-23 08:42:23.081078+00	0	1	healthy
458	2	2026-06-23 08:42:23.081078+00	0	1	healthy
459	3	2026-06-23 08:42:23.081078+00	0	1	healthy
460	4	2026-06-23 08:42:23.081078+00	0	1	healthy
461	1	2026-06-23 08:43:23.078265+00	0	1	healthy
462	5	2026-06-23 08:43:23.078265+00	0	1	healthy
463	2	2026-06-23 08:43:23.078265+00	0	1	healthy
464	3	2026-06-23 08:43:23.078265+00	0	1	healthy
465	4	2026-06-23 08:43:23.078265+00	0	1	healthy
466	1	2026-06-23 08:44:23.080456+00	0	1	healthy
467	5	2026-06-23 08:44:23.080456+00	0	1	healthy
468	2	2026-06-23 08:44:23.080456+00	0	1	healthy
469	3	2026-06-23 08:44:23.080456+00	0	1	healthy
470	4	2026-06-23 08:44:23.080456+00	0	1	healthy
471	1	2026-06-23 08:45:23.083099+00	0	1	healthy
472	5	2026-06-23 08:45:23.083099+00	0	1	healthy
473	2	2026-06-23 08:45:23.083099+00	0	1	healthy
474	3	2026-06-23 08:45:23.083099+00	0	1	healthy
475	4	2026-06-23 08:45:23.083099+00	0	1	healthy
476	1	2026-06-23 08:46:23.101875+00	0	1	healthy
477	5	2026-06-23 08:46:23.101875+00	0	1	healthy
478	2	2026-06-23 08:46:23.101875+00	0	1	healthy
479	3	2026-06-23 08:46:23.101875+00	0	1	healthy
480	4	2026-06-23 08:46:23.101875+00	0	1	healthy
481	1	2026-06-23 08:49:23.082143+00	0	1	healthy
482	5	2026-06-23 08:49:23.082143+00	0	1	healthy
483	2	2026-06-23 08:49:23.082143+00	0	1	healthy
484	3	2026-06-23 08:49:23.082143+00	0	1	healthy
485	4	2026-06-23 08:49:23.082143+00	0	1	healthy
486	1	2026-06-23 08:50:23.07824+00	0	1	healthy
487	5	2026-06-23 08:50:23.07824+00	0	1	healthy
488	2	2026-06-23 08:50:23.07824+00	0	1	healthy
489	3	2026-06-23 08:50:23.07824+00	0	1	healthy
490	4	2026-06-23 08:50:23.07824+00	0	1	healthy
491	1	2026-06-23 08:51:23.079803+00	0	1	healthy
492	5	2026-06-23 08:51:23.079803+00	0	1	healthy
493	2	2026-06-23 08:51:23.079803+00	0	1	healthy
494	3	2026-06-23 08:51:23.079803+00	0	1	healthy
495	4	2026-06-23 08:51:23.079803+00	0	1	healthy
496	1	2026-06-23 08:52:23.080483+00	0	1	healthy
497	5	2026-06-23 08:52:23.080483+00	0	1	healthy
498	2	2026-06-23 08:52:23.080483+00	0	1	healthy
499	3	2026-06-23 08:52:23.080483+00	0	1	healthy
500	4	2026-06-23 08:52:23.080483+00	0	1	healthy
501	1	2026-06-23 08:53:23.07837+00	0	1	healthy
502	5	2026-06-23 08:53:23.07837+00	0	1	healthy
503	2	2026-06-23 08:53:23.07837+00	0	1	healthy
504	3	2026-06-23 08:53:23.07837+00	0	1	healthy
505	4	2026-06-23 08:53:23.07837+00	0	1	healthy
506	1	2026-06-23 08:54:23.079388+00	0	1	healthy
507	5	2026-06-23 08:54:23.079388+00	0	1	healthy
508	2	2026-06-23 08:54:23.079388+00	0	1	healthy
509	3	2026-06-23 08:54:23.079388+00	0	1	healthy
510	4	2026-06-23 08:54:23.079388+00	0	1	healthy
511	1	2026-06-23 08:55:23.080078+00	0	1	healthy
512	5	2026-06-23 08:55:23.080078+00	0	1	healthy
513	2	2026-06-23 08:55:23.080078+00	0	1	healthy
514	3	2026-06-23 08:55:23.080078+00	0	1	healthy
515	4	2026-06-23 08:55:23.080078+00	0	1	healthy
516	1	2026-06-23 08:56:23.078783+00	0	1	healthy
517	5	2026-06-23 08:56:23.078783+00	0	1	healthy
518	2	2026-06-23 08:56:23.078783+00	0	1	healthy
519	3	2026-06-23 08:56:23.078783+00	0	1	healthy
520	4	2026-06-23 08:56:23.078783+00	0	1	healthy
521	1	2026-06-23 08:57:23.078301+00	0	1	healthy
522	5	2026-06-23 08:57:23.078301+00	0	1	healthy
523	2	2026-06-23 08:57:23.078301+00	0	1	healthy
524	3	2026-06-23 08:57:23.078301+00	0	1	healthy
525	4	2026-06-23 08:57:23.078301+00	0	1	healthy
531	1	2026-06-23 08:59:23.079724+00	0	1	healthy
532	5	2026-06-23 08:59:23.079724+00	0	1	healthy
533	2	2026-06-23 08:59:23.079724+00	0	1	healthy
534	3	2026-06-23 08:59:23.079724+00	0	1	healthy
535	4	2026-06-23 08:59:23.079724+00	0	1	healthy
566	1	2026-06-23 09:06:23.078423+00	0	1	healthy
567	5	2026-06-23 09:06:23.078423+00	0	1	healthy
568	2	2026-06-23 09:06:23.078423+00	0	1	healthy
569	3	2026-06-23 09:06:23.078423+00	0	1	healthy
570	4	2026-06-23 09:06:23.078423+00	0	1	healthy
576	1	2026-06-23 09:08:23.086083+00	0	1	healthy
577	5	2026-06-23 09:08:23.086083+00	0	1	healthy
578	2	2026-06-23 09:08:23.086083+00	0	1	healthy
579	3	2026-06-23 09:08:23.086083+00	0	1	healthy
580	4	2026-06-23 09:08:23.086083+00	0	1	healthy
596	1	2026-06-23 09:12:23.080078+00	0	1	healthy
597	5	2026-06-23 09:12:23.080078+00	0	1	healthy
598	2	2026-06-23 09:12:23.080078+00	0	1	healthy
599	3	2026-06-23 09:12:23.080078+00	0	1	healthy
600	4	2026-06-23 09:12:23.080078+00	0	1	healthy
1241	1	2026-06-23 12:25:23.079963+00	0	1	healthy
1242	5	2026-06-23 12:25:23.079963+00	0	1	healthy
1243	2	2026-06-23 12:25:23.079963+00	0	1	healthy
1244	3	2026-06-23 12:25:23.079963+00	0	1	healthy
1245	4	2026-06-23 12:25:23.079963+00	0	1	healthy
1256	1	2026-06-23 12:28:23.079153+00	0	1	healthy
1257	5	2026-06-23 12:28:23.079153+00	0	1	healthy
1258	2	2026-06-23 12:28:23.079153+00	0	1	healthy
1259	3	2026-06-23 12:28:23.079153+00	0	1	healthy
1260	4	2026-06-23 12:28:23.079153+00	0	1	healthy
1521	1	2026-06-23 21:19:23.081657+00	0	1	healthy
1522	5	2026-06-23 21:19:23.081657+00	0	1	healthy
1523	2	2026-06-23 21:19:23.081657+00	0	1	healthy
1524	3	2026-06-23 21:19:23.081657+00	0	1	healthy
1525	4	2026-06-23 21:19:23.081657+00	0	1	healthy
1541	1	2026-06-24 00:02:23.087143+00	0	1	healthy
1542	5	2026-06-24 00:02:23.087143+00	0	1	healthy
1543	2	2026-06-24 00:02:23.087143+00	0	1	healthy
1544	3	2026-06-24 00:02:23.087143+00	0	1	healthy
1545	4	2026-06-24 00:02:23.087143+00	0	1	healthy
1576	1	2026-06-24 01:45:23.084602+00	0	1	healthy
1577	5	2026-06-24 01:45:23.084602+00	0	1	healthy
1578	2	2026-06-24 01:45:23.084602+00	0	1	healthy
1579	3	2026-06-24 01:45:23.084602+00	0	1	healthy
1580	4	2026-06-24 01:45:23.084602+00	0	1	healthy
1591	1	2026-06-24 01:52:23.082257+00	0	1	healthy
1592	5	2026-06-24 01:52:23.082257+00	0	1	healthy
1593	2	2026-06-24 01:52:23.082257+00	0	1	healthy
1594	3	2026-06-24 01:52:23.082257+00	0	1	healthy
1595	4	2026-06-24 01:52:23.082257+00	0	1	healthy
1611	1	2026-06-24 01:56:23.079557+00	0	1	healthy
1612	5	2026-06-24 01:56:23.079557+00	0	1	healthy
1613	2	2026-06-24 01:56:23.079557+00	0	1	healthy
1614	3	2026-06-24 01:56:23.079557+00	0	1	healthy
1615	4	2026-06-24 01:56:23.079557+00	0	1	healthy
1626	1	2026-06-24 01:59:23.079376+00	0	1	healthy
1627	5	2026-06-24 01:59:23.079376+00	0	1	healthy
1628	2	2026-06-24 01:59:23.079376+00	0	1	healthy
1629	3	2026-06-24 01:59:23.079376+00	0	1	healthy
1630	4	2026-06-24 01:59:23.079376+00	0	1	healthy
1766	1	2026-06-24 02:27:23.081428+00	0	1	healthy
1767	5	2026-06-24 02:27:23.081428+00	0	1	healthy
1768	2	2026-06-24 02:27:23.081428+00	0	1	healthy
1769	3	2026-06-24 02:27:23.081428+00	0	1	healthy
1770	4	2026-06-24 02:27:23.081428+00	0	1	healthy
1941	1	2026-06-24 03:02:23.081078+00	0	1	healthy
1942	5	2026-06-24 03:02:23.081078+00	0	1	healthy
1943	2	2026-06-24 03:02:23.081078+00	0	1	healthy
1944	3	2026-06-24 03:02:23.081078+00	0	1	healthy
1945	4	2026-06-24 03:02:23.081078+00	0	1	healthy
1996	1	2026-06-24 03:15:23.080581+00	0	1	healthy
1997	5	2026-06-24 03:15:23.080581+00	0	1	healthy
1998	2	2026-06-24 03:15:23.080581+00	0	1	healthy
1999	3	2026-06-24 03:15:23.080581+00	0	1	healthy
2000	4	2026-06-24 03:15:23.080581+00	0	1	healthy
2011	1	2026-06-24 03:18:23.078866+00	0	1	healthy
2012	5	2026-06-24 03:18:23.078866+00	0	1	healthy
2013	2	2026-06-24 03:18:23.078866+00	0	1	healthy
2014	3	2026-06-24 03:18:23.078866+00	0	1	healthy
2015	4	2026-06-24 03:18:23.078866+00	0	1	healthy
2041	1	2026-06-24 03:24:23.078369+00	0	1	healthy
2042	5	2026-06-24 03:24:23.078369+00	0	1	healthy
2043	2	2026-06-24 03:24:23.078369+00	0	1	healthy
2044	3	2026-06-24 03:24:23.078369+00	0	1	healthy
2045	4	2026-06-24 03:24:23.078369+00	0	1	healthy
2116	1	2026-06-24 03:41:05.907811+00	0	1	healthy
2117	5	2026-06-24 03:41:05.907811+00	0	1	healthy
2118	2	2026-06-24 03:41:05.907811+00	0	1	healthy
2119	3	2026-06-24 03:41:05.907811+00	0	1	healthy
2120	4	2026-06-24 03:41:05.907811+00	0	1	healthy
2126	1	2026-06-24 03:43:05.911557+00	0	1	healthy
2127	5	2026-06-24 03:43:05.911557+00	0	1	healthy
2128	2	2026-06-24 03:43:05.911557+00	0	1	healthy
2129	3	2026-06-24 03:43:05.911557+00	0	1	healthy
2130	4	2026-06-24 03:43:05.911557+00	0	1	healthy
2136	1	2026-06-24 03:45:05.907664+00	0	1	healthy
2137	5	2026-06-24 03:45:05.907664+00	0	1	healthy
2138	2	2026-06-24 03:45:05.907664+00	0	1	healthy
2139	3	2026-06-24 03:45:05.907664+00	0	1	healthy
2140	4	2026-06-24 03:45:05.907664+00	0	1	healthy
2171	1	2026-06-24 03:52:05.90941+00	0	1	healthy
2172	5	2026-06-24 03:52:05.90941+00	0	1	healthy
2173	2	2026-06-24 03:52:05.90941+00	0	1	healthy
2174	3	2026-06-24 03:52:05.90941+00	0	1	healthy
2175	4	2026-06-24 03:52:05.90941+00	0	1	healthy
2186	1	2026-06-24 03:55:05.907464+00	0	1	healthy
2187	5	2026-06-24 03:55:05.907464+00	0	1	healthy
2188	2	2026-06-24 03:55:05.907464+00	0	1	healthy
2189	3	2026-06-24 03:55:05.907464+00	0	1	healthy
2190	4	2026-06-24 03:55:05.907464+00	0	1	healthy
526	1	2026-06-23 08:58:23.078611+00	0	1	healthy
527	5	2026-06-23 08:58:23.078611+00	0	1	healthy
528	2	2026-06-23 08:58:23.078611+00	0	1	healthy
529	3	2026-06-23 08:58:23.078611+00	0	1	healthy
530	4	2026-06-23 08:58:23.078611+00	0	1	healthy
536	1	2026-06-23 09:00:23.07901+00	0	1	healthy
537	5	2026-06-23 09:00:23.07901+00	0	1	healthy
538	2	2026-06-23 09:00:23.07901+00	0	1	healthy
539	3	2026-06-23 09:00:23.07901+00	0	1	healthy
540	4	2026-06-23 09:00:23.07901+00	0	1	healthy
541	1	2026-06-23 09:01:23.082088+00	0	1	healthy
542	5	2026-06-23 09:01:23.082088+00	0	1	healthy
543	2	2026-06-23 09:01:23.082088+00	0	1	healthy
544	3	2026-06-23 09:01:23.082088+00	0	1	healthy
545	4	2026-06-23 09:01:23.082088+00	0	1	healthy
546	1	2026-06-23 09:02:23.0821+00	0	1	healthy
547	5	2026-06-23 09:02:23.0821+00	0	1	healthy
548	2	2026-06-23 09:02:23.0821+00	0	1	healthy
549	3	2026-06-23 09:02:23.0821+00	0	1	healthy
550	4	2026-06-23 09:02:23.0821+00	0	1	healthy
551	1	2026-06-23 09:03:23.079972+00	0	1	healthy
552	5	2026-06-23 09:03:23.079972+00	0	1	healthy
553	2	2026-06-23 09:03:23.079972+00	0	1	healthy
554	3	2026-06-23 09:03:23.079972+00	0	1	healthy
555	4	2026-06-23 09:03:23.079972+00	0	1	healthy
556	1	2026-06-23 09:04:23.079952+00	0	1	healthy
557	5	2026-06-23 09:04:23.079952+00	0	1	healthy
558	2	2026-06-23 09:04:23.079952+00	0	1	healthy
559	3	2026-06-23 09:04:23.079952+00	0	1	healthy
560	4	2026-06-23 09:04:23.079952+00	0	1	healthy
561	1	2026-06-23 09:05:23.078834+00	0	1	healthy
562	5	2026-06-23 09:05:23.078834+00	0	1	healthy
563	2	2026-06-23 09:05:23.078834+00	0	1	healthy
564	3	2026-06-23 09:05:23.078834+00	0	1	healthy
565	4	2026-06-23 09:05:23.078834+00	0	1	healthy
571	1	2026-06-23 09:07:23.080435+00	0	1	healthy
572	5	2026-06-23 09:07:23.080435+00	0	1	healthy
573	2	2026-06-23 09:07:23.080435+00	0	1	healthy
574	3	2026-06-23 09:07:23.080435+00	0	1	healthy
575	4	2026-06-23 09:07:23.080435+00	0	1	healthy
581	1	2026-06-23 09:09:23.079823+00	0	1	healthy
582	5	2026-06-23 09:09:23.079823+00	0	1	healthy
583	2	2026-06-23 09:09:23.079823+00	0	1	healthy
584	3	2026-06-23 09:09:23.079823+00	0	1	healthy
585	4	2026-06-23 09:09:23.079823+00	0	1	healthy
586	1	2026-06-23 09:10:23.079297+00	0	1	healthy
587	5	2026-06-23 09:10:23.079297+00	0	1	healthy
588	2	2026-06-23 09:10:23.079297+00	0	1	healthy
589	3	2026-06-23 09:10:23.079297+00	0	1	healthy
590	4	2026-06-23 09:10:23.079297+00	0	1	healthy
591	1	2026-06-23 09:11:23.078633+00	0	1	healthy
592	5	2026-06-23 09:11:23.078633+00	0	1	healthy
593	2	2026-06-23 09:11:23.078633+00	0	1	healthy
594	3	2026-06-23 09:11:23.078633+00	0	1	healthy
595	4	2026-06-23 09:11:23.078633+00	0	1	healthy
601	1	2026-06-23 09:13:23.078185+00	0	1	healthy
602	5	2026-06-23 09:13:23.078185+00	0	1	healthy
603	2	2026-06-23 09:13:23.078185+00	0	1	healthy
604	3	2026-06-23 09:13:23.078185+00	0	1	healthy
605	4	2026-06-23 09:13:23.078185+00	0	1	healthy
606	1	2026-06-23 09:14:23.079563+00	0	1	healthy
607	5	2026-06-23 09:14:23.079563+00	0	1	healthy
608	2	2026-06-23 09:14:23.079563+00	0	1	healthy
609	3	2026-06-23 09:14:23.079563+00	0	1	healthy
610	4	2026-06-23 09:14:23.079563+00	0	1	healthy
611	1	2026-06-23 09:15:23.079823+00	0	1	healthy
612	5	2026-06-23 09:15:23.079823+00	0	1	healthy
613	2	2026-06-23 09:15:23.079823+00	0	1	healthy
614	3	2026-06-23 09:15:23.079823+00	0	1	healthy
615	4	2026-06-23 09:15:23.079823+00	0	1	healthy
616	1	2026-06-23 09:16:23.079173+00	0	1	healthy
617	5	2026-06-23 09:16:23.079173+00	0	1	healthy
618	2	2026-06-23 09:16:23.079173+00	0	1	healthy
619	3	2026-06-23 09:16:23.079173+00	0	1	healthy
620	4	2026-06-23 09:16:23.079173+00	0	1	healthy
621	1	2026-06-23 09:17:23.078699+00	0	1	healthy
622	5	2026-06-23 09:17:23.078699+00	0	1	healthy
623	2	2026-06-23 09:17:23.078699+00	0	1	healthy
624	3	2026-06-23 09:17:23.078699+00	0	1	healthy
625	4	2026-06-23 09:17:23.078699+00	0	1	healthy
626	1	2026-06-23 09:18:23.144119+00	0	1	healthy
627	5	2026-06-23 09:18:23.144119+00	0	1	healthy
628	2	2026-06-23 09:18:23.144119+00	0	1	healthy
629	3	2026-06-23 09:18:23.144119+00	0	1	healthy
630	4	2026-06-23 09:18:23.144119+00	0	1	healthy
631	1	2026-06-23 09:19:23.078184+00	0	1	healthy
632	5	2026-06-23 09:19:23.078184+00	0	1	healthy
633	2	2026-06-23 09:19:23.078184+00	0	1	healthy
634	3	2026-06-23 09:19:23.078184+00	0	1	healthy
635	4	2026-06-23 09:19:23.078184+00	0	1	healthy
636	1	2026-06-23 09:20:23.079561+00	0	1	healthy
637	5	2026-06-23 09:20:23.079561+00	0	1	healthy
638	2	2026-06-23 09:20:23.079561+00	0	1	healthy
639	3	2026-06-23 09:20:23.079561+00	0	1	healthy
640	4	2026-06-23 09:20:23.079561+00	0	1	healthy
641	1	2026-06-23 09:21:23.078926+00	0	1	healthy
642	5	2026-06-23 09:21:23.078926+00	0	1	healthy
643	2	2026-06-23 09:21:23.078926+00	0	1	healthy
644	3	2026-06-23 09:21:23.078926+00	0	1	healthy
645	4	2026-06-23 09:21:23.078926+00	0	1	healthy
646	1	2026-06-23 09:22:23.080502+00	0	1	healthy
647	5	2026-06-23 09:22:23.080502+00	0	1	healthy
648	2	2026-06-23 09:22:23.080502+00	0	1	healthy
649	3	2026-06-23 09:22:23.080502+00	0	1	healthy
650	4	2026-06-23 09:22:23.080502+00	0	1	healthy
651	1	2026-06-23 09:23:23.079257+00	0	1	healthy
652	5	2026-06-23 09:23:23.079257+00	0	1	healthy
653	2	2026-06-23 09:23:23.079257+00	0	1	healthy
654	3	2026-06-23 09:23:23.079257+00	0	1	healthy
655	4	2026-06-23 09:23:23.079257+00	0	1	healthy
656	1	2026-06-23 09:24:23.079671+00	0	1	healthy
657	5	2026-06-23 09:24:23.079671+00	0	1	healthy
658	2	2026-06-23 09:24:23.079671+00	0	1	healthy
659	3	2026-06-23 09:24:23.079671+00	0	1	healthy
660	4	2026-06-23 09:24:23.079671+00	0	1	healthy
661	1	2026-06-23 09:25:23.07972+00	0	1	healthy
662	5	2026-06-23 09:25:23.07972+00	0	1	healthy
663	2	2026-06-23 09:25:23.07972+00	0	1	healthy
664	3	2026-06-23 09:25:23.07972+00	0	1	healthy
665	4	2026-06-23 09:25:23.07972+00	0	1	healthy
666	1	2026-06-23 09:26:23.079534+00	0	1	healthy
667	5	2026-06-23 09:26:23.079534+00	0	1	healthy
668	2	2026-06-23 09:26:23.079534+00	0	1	healthy
669	3	2026-06-23 09:26:23.079534+00	0	1	healthy
670	4	2026-06-23 09:26:23.079534+00	0	1	healthy
671	1	2026-06-23 09:27:23.079633+00	0	1	healthy
672	5	2026-06-23 09:27:23.079633+00	0	1	healthy
673	2	2026-06-23 09:27:23.079633+00	0	1	healthy
674	3	2026-06-23 09:27:23.079633+00	0	1	healthy
675	4	2026-06-23 09:27:23.079633+00	0	1	healthy
676	1	2026-06-23 09:28:23.07827+00	0	1	healthy
677	5	2026-06-23 09:28:23.07827+00	0	1	healthy
678	2	2026-06-23 09:28:23.07827+00	0	1	healthy
679	3	2026-06-23 09:28:23.07827+00	0	1	healthy
680	4	2026-06-23 09:28:23.07827+00	0	1	healthy
681	1	2026-06-23 09:29:23.078878+00	0	1	healthy
682	5	2026-06-23 09:29:23.078878+00	0	1	healthy
683	2	2026-06-23 09:29:23.078878+00	0	1	healthy
684	3	2026-06-23 09:29:23.078878+00	0	1	healthy
685	4	2026-06-23 09:29:23.078878+00	0	1	healthy
686	1	2026-06-23 09:30:23.07883+00	0	1	healthy
687	5	2026-06-23 09:30:23.07883+00	0	1	healthy
688	2	2026-06-23 09:30:23.07883+00	0	1	healthy
689	3	2026-06-23 09:30:23.07883+00	0	1	healthy
690	4	2026-06-23 09:30:23.07883+00	0	1	healthy
691	1	2026-06-23 09:31:23.078903+00	0	1	healthy
692	5	2026-06-23 09:31:23.078903+00	0	1	healthy
693	2	2026-06-23 09:31:23.078903+00	0	1	healthy
694	3	2026-06-23 09:31:23.078903+00	0	1	healthy
695	4	2026-06-23 09:31:23.078903+00	0	1	healthy
696	1	2026-06-23 09:32:23.080539+00	0	1	healthy
697	5	2026-06-23 09:32:23.080539+00	0	1	healthy
698	2	2026-06-23 09:32:23.080539+00	0	1	healthy
699	3	2026-06-23 09:32:23.080539+00	0	1	healthy
700	4	2026-06-23 09:32:23.080539+00	0	1	healthy
701	1	2026-06-23 09:33:23.144426+00	0	1	healthy
702	5	2026-06-23 09:33:23.144426+00	0	1	healthy
703	2	2026-06-23 09:33:23.144426+00	0	1	healthy
704	3	2026-06-23 09:33:23.144426+00	0	1	healthy
705	4	2026-06-23 09:33:23.144426+00	0	1	healthy
711	1	2026-06-23 09:35:23.078616+00	0	1	healthy
712	5	2026-06-23 09:35:23.078616+00	0	1	healthy
713	2	2026-06-23 09:35:23.078616+00	0	1	healthy
714	3	2026-06-23 09:35:23.078616+00	0	1	healthy
715	4	2026-06-23 09:35:23.078616+00	0	1	healthy
716	1	2026-06-23 09:36:23.079363+00	0	1	healthy
717	5	2026-06-23 09:36:23.079363+00	0	1	healthy
718	2	2026-06-23 09:36:23.079363+00	0	1	healthy
719	3	2026-06-23 09:36:23.079363+00	0	1	healthy
720	4	2026-06-23 09:36:23.079363+00	0	1	healthy
721	1	2026-06-23 09:37:23.079997+00	0	1	healthy
722	5	2026-06-23 09:37:23.079997+00	0	1	healthy
723	2	2026-06-23 09:37:23.079997+00	0	1	healthy
724	3	2026-06-23 09:37:23.079997+00	0	1	healthy
725	4	2026-06-23 09:37:23.079997+00	0	1	healthy
726	1	2026-06-23 09:38:23.079563+00	0	1	healthy
727	5	2026-06-23 09:38:23.079563+00	0	1	healthy
728	2	2026-06-23 09:38:23.079563+00	0	1	healthy
729	3	2026-06-23 09:38:23.079563+00	0	1	healthy
730	4	2026-06-23 09:38:23.079563+00	0	1	healthy
1246	1	2026-06-23 12:26:23.080363+00	0	1	healthy
1247	5	2026-06-23 12:26:23.080363+00	0	1	healthy
1248	2	2026-06-23 12:26:23.080363+00	0	1	healthy
1249	3	2026-06-23 12:26:23.080363+00	0	1	healthy
1250	4	2026-06-23 12:26:23.080363+00	0	1	healthy
1261	1	2026-06-23 12:45:23.080216+00	0	1	healthy
1262	5	2026-06-23 12:45:23.080216+00	0	1	healthy
1263	2	2026-06-23 12:45:23.080216+00	0	1	healthy
1264	3	2026-06-23 12:45:23.080216+00	0	1	healthy
1265	4	2026-06-23 12:45:23.080216+00	0	1	healthy
1276	1	2026-06-23 12:48:23.079781+00	0	1	healthy
1277	5	2026-06-23 12:48:23.079781+00	0	1	healthy
1278	2	2026-06-23 12:48:23.079781+00	0	1	healthy
1279	3	2026-06-23 12:48:23.079781+00	0	1	healthy
1280	4	2026-06-23 12:48:23.079781+00	0	1	healthy
1296	1	2026-06-23 13:12:23.087108+00	0	1	healthy
1297	5	2026-06-23 13:12:23.087108+00	0	1	healthy
1298	2	2026-06-23 13:12:23.087108+00	0	1	healthy
1299	3	2026-06-23 13:12:23.087108+00	0	1	healthy
1300	4	2026-06-23 13:12:23.087108+00	0	1	healthy
1311	1	2026-06-23 13:47:23.084631+00	0	1	healthy
1312	5	2026-06-23 13:47:23.084631+00	0	1	healthy
1313	2	2026-06-23 13:47:23.084631+00	0	1	healthy
1314	3	2026-06-23 13:47:23.084631+00	0	1	healthy
1315	4	2026-06-23 13:47:23.084631+00	0	1	healthy
1526	1	2026-06-23 22:26:23.083945+00	0	1	healthy
1527	5	2026-06-23 22:26:23.083945+00	0	1	healthy
1528	2	2026-06-23 22:26:23.083945+00	0	1	healthy
1529	3	2026-06-23 22:26:23.083945+00	0	1	healthy
1530	4	2026-06-23 22:26:23.083945+00	0	1	healthy
1556	1	2026-06-24 01:38:23.079275+00	0	1	healthy
1557	5	2026-06-24 01:38:23.079275+00	0	1	healthy
1558	2	2026-06-24 01:38:23.079275+00	0	1	healthy
1559	3	2026-06-24 01:38:23.079275+00	0	1	healthy
1560	4	2026-06-24 01:38:23.079275+00	0	1	healthy
1566	1	2026-06-24 01:43:23.084016+00	0	1	healthy
1567	5	2026-06-24 01:43:23.084016+00	0	1	healthy
1568	2	2026-06-24 01:43:23.084016+00	0	1	healthy
1569	3	2026-06-24 01:43:23.084016+00	0	1	healthy
1570	4	2026-06-24 01:43:23.084016+00	0	1	healthy
1606	1	2026-06-24 01:55:23.078897+00	0	1	healthy
1607	5	2026-06-24 01:55:23.078897+00	0	1	healthy
1608	2	2026-06-24 01:55:23.078897+00	0	1	healthy
1609	3	2026-06-24 01:55:23.078897+00	0	1	healthy
1610	4	2026-06-24 01:55:23.078897+00	0	1	healthy
1621	1	2026-06-24 01:58:23.079178+00	0	1	healthy
1622	5	2026-06-24 01:58:23.079178+00	0	1	healthy
1623	2	2026-06-24 01:58:23.079178+00	0	1	healthy
1624	3	2026-06-24 01:58:23.079178+00	0	1	healthy
1625	4	2026-06-24 01:58:23.079178+00	0	1	healthy
1631	1	2026-06-24 02:00:23.080185+00	0	1	healthy
1632	5	2026-06-24 02:00:23.080185+00	0	1	healthy
1633	2	2026-06-24 02:00:23.080185+00	0	1	healthy
1634	3	2026-06-24 02:00:23.080185+00	0	1	healthy
1635	4	2026-06-24 02:00:23.080185+00	0	1	healthy
1636	1	2026-06-24 02:01:23.079077+00	0	1	healthy
1637	5	2026-06-24 02:01:23.079077+00	0	1	healthy
1638	2	2026-06-24 02:01:23.079077+00	0	1	healthy
1639	3	2026-06-24 02:01:23.079077+00	0	1	healthy
1640	4	2026-06-24 02:01:23.079077+00	0	1	healthy
706	1	2026-06-23 09:34:23.07875+00	0	1	healthy
707	5	2026-06-23 09:34:23.07875+00	0	1	healthy
708	2	2026-06-23 09:34:23.07875+00	0	1	healthy
709	3	2026-06-23 09:34:23.07875+00	0	1	healthy
710	4	2026-06-23 09:34:23.07875+00	0	1	healthy
731	1	2026-06-23 09:39:23.07904+00	0	1	healthy
732	5	2026-06-23 09:39:23.07904+00	0	1	healthy
733	2	2026-06-23 09:39:23.07904+00	0	1	healthy
734	3	2026-06-23 09:39:23.07904+00	0	1	healthy
735	4	2026-06-23 09:39:23.07904+00	0	1	healthy
736	1	2026-06-23 09:40:23.078802+00	0	1	healthy
737	5	2026-06-23 09:40:23.078802+00	0	1	healthy
738	2	2026-06-23 09:40:23.078802+00	0	1	healthy
739	3	2026-06-23 09:40:23.078802+00	0	1	healthy
740	4	2026-06-23 09:40:23.078802+00	0	1	healthy
741	1	2026-06-23 09:41:23.081755+00	0	1	healthy
742	5	2026-06-23 09:41:23.081755+00	0	1	healthy
743	2	2026-06-23 09:41:23.081755+00	0	1	healthy
744	3	2026-06-23 09:41:23.081755+00	0	1	healthy
745	4	2026-06-23 09:41:23.081755+00	0	1	healthy
746	1	2026-06-23 09:42:23.080558+00	0	1	healthy
747	5	2026-06-23 09:42:23.080558+00	0	1	healthy
748	2	2026-06-23 09:42:23.080558+00	0	1	healthy
749	3	2026-06-23 09:42:23.080558+00	0	1	healthy
750	4	2026-06-23 09:42:23.080558+00	0	1	healthy
751	1	2026-06-23 09:43:23.078204+00	0	1	healthy
752	5	2026-06-23 09:43:23.078204+00	0	1	healthy
753	2	2026-06-23 09:43:23.078204+00	0	1	healthy
754	3	2026-06-23 09:43:23.078204+00	0	1	healthy
755	4	2026-06-23 09:43:23.078204+00	0	1	healthy
756	1	2026-06-23 09:44:23.078195+00	0	1	healthy
757	5	2026-06-23 09:44:23.078195+00	0	1	healthy
758	2	2026-06-23 09:44:23.078195+00	0	1	healthy
759	3	2026-06-23 09:44:23.078195+00	0	1	healthy
760	4	2026-06-23 09:44:23.078195+00	0	1	healthy
761	1	2026-06-23 09:45:23.078188+00	0	1	healthy
762	5	2026-06-23 09:45:23.078188+00	0	1	healthy
763	2	2026-06-23 09:45:23.078188+00	0	1	healthy
764	3	2026-06-23 09:45:23.078188+00	0	1	healthy
765	4	2026-06-23 09:45:23.078188+00	0	1	healthy
766	1	2026-06-23 09:46:23.078423+00	0	1	healthy
767	5	2026-06-23 09:46:23.078423+00	0	1	healthy
768	2	2026-06-23 09:46:23.078423+00	0	1	healthy
769	3	2026-06-23 09:46:23.078423+00	0	1	healthy
770	4	2026-06-23 09:46:23.078423+00	0	1	healthy
771	1	2026-06-23 09:47:23.079833+00	0	1	healthy
772	5	2026-06-23 09:47:23.079833+00	0	1	healthy
773	2	2026-06-23 09:47:23.079833+00	0	1	healthy
774	3	2026-06-23 09:47:23.079833+00	0	1	healthy
775	4	2026-06-23 09:47:23.079833+00	0	1	healthy
776	1	2026-06-23 09:48:23.082117+00	0	1	healthy
777	5	2026-06-23 09:48:23.082117+00	0	1	healthy
778	2	2026-06-23 09:48:23.082117+00	0	1	healthy
779	3	2026-06-23 09:48:23.082117+00	0	1	healthy
780	4	2026-06-23 09:48:23.082117+00	0	1	healthy
781	1	2026-06-23 09:49:23.079548+00	0	1	healthy
782	5	2026-06-23 09:49:23.079548+00	0	1	healthy
783	2	2026-06-23 09:49:23.079548+00	0	1	healthy
784	3	2026-06-23 09:49:23.079548+00	0	1	healthy
785	4	2026-06-23 09:49:23.079548+00	0	1	healthy
786	1	2026-06-23 09:50:23.079851+00	0	1	healthy
787	5	2026-06-23 09:50:23.079851+00	0	1	healthy
788	2	2026-06-23 09:50:23.079851+00	0	1	healthy
789	3	2026-06-23 09:50:23.079851+00	0	1	healthy
790	4	2026-06-23 09:50:23.079851+00	0	1	healthy
791	1	2026-06-23 09:51:23.07954+00	0	1	healthy
792	5	2026-06-23 09:51:23.07954+00	0	1	healthy
793	2	2026-06-23 09:51:23.07954+00	0	1	healthy
794	3	2026-06-23 09:51:23.07954+00	0	1	healthy
795	4	2026-06-23 09:51:23.07954+00	0	1	healthy
796	1	2026-06-23 09:52:23.080826+00	0	1	healthy
797	5	2026-06-23 09:52:23.080826+00	0	1	healthy
798	2	2026-06-23 09:52:23.080826+00	0	1	healthy
799	3	2026-06-23 09:52:23.080826+00	0	1	healthy
800	4	2026-06-23 09:52:23.080826+00	0	1	healthy
801	1	2026-06-23 09:53:23.07857+00	0	1	healthy
802	5	2026-06-23 09:53:23.07857+00	0	1	healthy
803	2	2026-06-23 09:53:23.07857+00	0	1	healthy
804	3	2026-06-23 09:53:23.07857+00	0	1	healthy
805	4	2026-06-23 09:53:23.07857+00	0	1	healthy
806	1	2026-06-23 09:54:23.078919+00	0	1	healthy
807	5	2026-06-23 09:54:23.078919+00	0	1	healthy
808	2	2026-06-23 09:54:23.078919+00	0	1	healthy
809	3	2026-06-23 09:54:23.078919+00	0	1	healthy
810	4	2026-06-23 09:54:23.078919+00	0	1	healthy
811	1	2026-06-23 09:55:23.078222+00	0	1	healthy
812	5	2026-06-23 09:55:23.078222+00	0	1	healthy
813	2	2026-06-23 09:55:23.078222+00	0	1	healthy
814	3	2026-06-23 09:55:23.078222+00	0	1	healthy
815	4	2026-06-23 09:55:23.078222+00	0	1	healthy
816	1	2026-06-23 09:56:23.0803+00	0	1	healthy
817	5	2026-06-23 09:56:23.0803+00	0	1	healthy
818	2	2026-06-23 09:56:23.0803+00	0	1	healthy
819	3	2026-06-23 09:56:23.0803+00	0	1	healthy
820	4	2026-06-23 09:56:23.0803+00	0	1	healthy
821	1	2026-06-23 09:57:23.079824+00	0	1	healthy
822	5	2026-06-23 09:57:23.079824+00	0	1	healthy
823	2	2026-06-23 09:57:23.079824+00	0	1	healthy
824	3	2026-06-23 09:57:23.079824+00	0	1	healthy
825	4	2026-06-23 09:57:23.079824+00	0	1	healthy
826	1	2026-06-23 09:58:23.079357+00	0	1	healthy
827	5	2026-06-23 09:58:23.079357+00	0	1	healthy
828	2	2026-06-23 09:58:23.079357+00	0	1	healthy
829	3	2026-06-23 09:58:23.079357+00	0	1	healthy
830	4	2026-06-23 09:58:23.079357+00	0	1	healthy
831	1	2026-06-23 09:59:23.079226+00	0	1	healthy
832	5	2026-06-23 09:59:23.079226+00	0	1	healthy
833	2	2026-06-23 09:59:23.079226+00	0	1	healthy
834	3	2026-06-23 09:59:23.079226+00	0	1	healthy
835	4	2026-06-23 09:59:23.079226+00	0	1	healthy
836	1	2026-06-23 10:00:23.079035+00	0	1	healthy
837	5	2026-06-23 10:00:23.079035+00	0	1	healthy
838	2	2026-06-23 10:00:23.079035+00	0	1	healthy
839	3	2026-06-23 10:00:23.079035+00	0	1	healthy
840	4	2026-06-23 10:00:23.079035+00	0	1	healthy
841	1	2026-06-23 10:01:23.078716+00	0	1	healthy
842	5	2026-06-23 10:01:23.078716+00	0	1	healthy
843	2	2026-06-23 10:01:23.078716+00	0	1	healthy
844	3	2026-06-23 10:01:23.078716+00	0	1	healthy
845	4	2026-06-23 10:01:23.078716+00	0	1	healthy
846	1	2026-06-23 10:02:23.08158+00	0	1	healthy
847	5	2026-06-23 10:02:23.08158+00	0	1	healthy
848	2	2026-06-23 10:02:23.08158+00	0	1	healthy
849	3	2026-06-23 10:02:23.08158+00	0	1	healthy
850	4	2026-06-23 10:02:23.08158+00	0	1	healthy
1251	1	2026-06-23 12:27:23.080297+00	0	1	healthy
1252	5	2026-06-23 12:27:23.080297+00	0	1	healthy
1253	2	2026-06-23 12:27:23.080297+00	0	1	healthy
1254	3	2026-06-23 12:27:23.080297+00	0	1	healthy
1255	4	2026-06-23 12:27:23.080297+00	0	1	healthy
1266	1	2026-06-23 12:46:23.079921+00	0	1	healthy
1267	5	2026-06-23 12:46:23.079921+00	0	1	healthy
1268	2	2026-06-23 12:46:23.079921+00	0	1	healthy
1269	3	2026-06-23 12:46:23.079921+00	0	1	healthy
1270	4	2026-06-23 12:46:23.079921+00	0	1	healthy
1281	1	2026-06-23 12:49:23.079216+00	0	1	healthy
1282	5	2026-06-23 12:49:23.079216+00	0	1	healthy
1283	2	2026-06-23 12:49:23.079216+00	0	1	healthy
1284	3	2026-06-23 12:49:23.079216+00	0	1	healthy
1285	4	2026-06-23 12:49:23.079216+00	0	1	healthy
1306	1	2026-06-23 13:30:23.080704+00	0	1	healthy
1307	5	2026-06-23 13:30:23.080704+00	0	1	healthy
1308	2	2026-06-23 13:30:23.080704+00	0	1	healthy
1309	3	2026-06-23 13:30:23.080704+00	0	1	healthy
1310	4	2026-06-23 13:30:23.080704+00	0	1	healthy
1656	1	2026-06-24 02:05:23.07915+00	0	1	healthy
1657	5	2026-06-24 02:05:23.07915+00	0	1	healthy
1658	2	2026-06-24 02:05:23.07915+00	0	1	healthy
1659	3	2026-06-24 02:05:23.07915+00	0	1	healthy
1660	4	2026-06-24 02:05:23.07915+00	0	1	healthy
1691	1	2026-06-24 02:12:23.08063+00	0	1	healthy
1692	5	2026-06-24 02:12:23.08063+00	0	1	healthy
1693	2	2026-06-24 02:12:23.08063+00	0	1	healthy
1694	3	2026-06-24 02:12:23.08063+00	0	1	healthy
1695	4	2026-06-24 02:12:23.08063+00	0	1	healthy
1776	1	2026-06-24 02:29:23.078377+00	0	1	healthy
1777	5	2026-06-24 02:29:23.078377+00	0	1	healthy
1778	2	2026-06-24 02:29:23.078377+00	0	1	healthy
1779	3	2026-06-24 02:29:23.078377+00	0	1	healthy
1780	4	2026-06-24 02:29:23.078377+00	0	1	healthy
1796	1	2026-06-24 02:33:23.079796+00	0	1	healthy
1797	5	2026-06-24 02:33:23.079796+00	0	1	healthy
1798	2	2026-06-24 02:33:23.079796+00	0	1	healthy
1799	3	2026-06-24 02:33:23.079796+00	0	1	healthy
1800	4	2026-06-24 02:33:23.079796+00	0	1	healthy
1826	1	2026-06-24 02:39:23.154266+00	0	1	healthy
1827	5	2026-06-24 02:39:23.154266+00	0	1	healthy
1828	2	2026-06-24 02:39:23.154266+00	0	1	healthy
1829	3	2026-06-24 02:39:23.154266+00	0	1	healthy
1830	4	2026-06-24 02:39:23.154266+00	0	1	healthy
1836	1	2026-06-24 02:41:23.080332+00	0	1	healthy
1837	5	2026-06-24 02:41:23.080332+00	0	1	healthy
1838	2	2026-06-24 02:41:23.080332+00	0	1	healthy
1839	3	2026-06-24 02:41:23.080332+00	0	1	healthy
1840	4	2026-06-24 02:41:23.080332+00	0	1	healthy
1856	1	2026-06-24 02:45:23.079371+00	0	1	healthy
1857	5	2026-06-24 02:45:23.079371+00	0	1	healthy
1858	2	2026-06-24 02:45:23.079371+00	0	1	healthy
1859	3	2026-06-24 02:45:23.079371+00	0	1	healthy
1860	4	2026-06-24 02:45:23.079371+00	0	1	healthy
1871	1	2026-06-24 02:48:23.079913+00	0	1	healthy
1872	5	2026-06-24 02:48:23.079913+00	0	1	healthy
1873	2	2026-06-24 02:48:23.079913+00	0	1	healthy
1874	3	2026-06-24 02:48:23.079913+00	0	1	healthy
1875	4	2026-06-24 02:48:23.079913+00	0	1	healthy
1886	1	2026-06-24 02:51:23.07883+00	0	1	healthy
1887	5	2026-06-24 02:51:23.07883+00	0	1	healthy
1888	2	2026-06-24 02:51:23.07883+00	0	1	healthy
1889	3	2026-06-24 02:51:23.07883+00	0	1	healthy
1890	4	2026-06-24 02:51:23.07883+00	0	1	healthy
1951	1	2026-06-24 03:04:23.079816+00	0	1	healthy
1952	5	2026-06-24 03:04:23.079816+00	0	1	healthy
1953	2	2026-06-24 03:04:23.079816+00	0	1	healthy
1954	3	2026-06-24 03:04:23.079816+00	0	1	healthy
1955	4	2026-06-24 03:04:23.079816+00	0	1	healthy
1981	1	2026-06-24 03:12:23.079485+00	0	1	healthy
1982	5	2026-06-24 03:12:23.079485+00	0	1	healthy
1983	2	2026-06-24 03:12:23.079485+00	0	1	healthy
1984	3	2026-06-24 03:12:23.079485+00	0	1	healthy
1985	4	2026-06-24 03:12:23.079485+00	0	1	healthy
2001	1	2026-06-24 03:16:23.078823+00	0	1	healthy
2002	5	2026-06-24 03:16:23.078823+00	0	1	healthy
2003	2	2026-06-24 03:16:23.078823+00	0	1	healthy
2004	3	2026-06-24 03:16:23.078823+00	0	1	healthy
2005	4	2026-06-24 03:16:23.078823+00	0	1	healthy
2016	1	2026-06-24 03:19:23.079612+00	0	1	healthy
2017	5	2026-06-24 03:19:23.079612+00	0	1	healthy
2018	2	2026-06-24 03:19:23.079612+00	0	1	healthy
2019	3	2026-06-24 03:19:23.079612+00	0	1	healthy
2020	4	2026-06-24 03:19:23.079612+00	0	1	healthy
2031	1	2026-06-24 03:22:23.089603+00	0	1	healthy
2032	5	2026-06-24 03:22:23.089603+00	0	1	healthy
2033	2	2026-06-24 03:22:23.089603+00	0	1	healthy
2034	3	2026-06-24 03:22:23.089603+00	0	1	healthy
2035	4	2026-06-24 03:22:23.089603+00	0	1	healthy
2036	1	2026-06-24 03:23:23.07974+00	0	1	healthy
2037	5	2026-06-24 03:23:23.07974+00	0	1	healthy
2038	2	2026-06-24 03:23:23.07974+00	0	1	healthy
2039	3	2026-06-24 03:23:23.07974+00	0	1	healthy
2040	4	2026-06-24 03:23:23.07974+00	0	1	healthy
2071	1	2026-06-24 03:30:23.08248+00	0	1	healthy
2072	5	2026-06-24 03:30:23.08248+00	0	1	healthy
2073	2	2026-06-24 03:30:23.08248+00	0	1	healthy
2074	3	2026-06-24 03:30:23.08248+00	0	1	healthy
2075	4	2026-06-24 03:30:23.08248+00	0	1	healthy
2121	1	2026-06-24 03:42:05.908065+00	0	1	healthy
2122	5	2026-06-24 03:42:05.908065+00	0	1	healthy
2123	2	2026-06-24 03:42:05.908065+00	0	1	healthy
2124	3	2026-06-24 03:42:05.908065+00	0	1	healthy
2125	4	2026-06-24 03:42:05.908065+00	0	1	healthy
2131	1	2026-06-24 03:44:05.907946+00	0	1	healthy
2132	5	2026-06-24 03:44:05.907946+00	0	1	healthy
2133	2	2026-06-24 03:44:05.907946+00	0	1	healthy
2134	3	2026-06-24 03:44:05.907946+00	0	1	healthy
2135	4	2026-06-24 03:44:05.907946+00	0	1	healthy
2151	1	2026-06-24 03:48:05.907428+00	0	1	healthy
2152	5	2026-06-24 03:48:05.907428+00	0	1	healthy
2153	2	2026-06-24 03:48:05.907428+00	0	1	healthy
2154	3	2026-06-24 03:48:05.907428+00	0	1	healthy
2155	4	2026-06-24 03:48:05.907428+00	0	1	healthy
851	1	2026-06-23 10:03:23.154957+00	0	1	healthy
852	5	2026-06-23 10:03:23.154957+00	0	1	healthy
853	2	2026-06-23 10:03:23.154957+00	0	1	healthy
854	3	2026-06-23 10:03:23.154957+00	0	1	healthy
855	4	2026-06-23 10:03:23.154957+00	0	1	healthy
856	1	2026-06-23 10:04:23.079498+00	0	1	healthy
857	5	2026-06-23 10:04:23.079498+00	0	1	healthy
858	2	2026-06-23 10:04:23.079498+00	0	1	healthy
859	3	2026-06-23 10:04:23.079498+00	0	1	healthy
860	4	2026-06-23 10:04:23.079498+00	0	1	healthy
861	1	2026-06-23 10:05:23.078975+00	0	1	healthy
862	5	2026-06-23 10:05:23.078975+00	0	1	healthy
863	2	2026-06-23 10:05:23.078975+00	0	1	healthy
864	3	2026-06-23 10:05:23.078975+00	0	1	healthy
865	4	2026-06-23 10:05:23.078975+00	0	1	healthy
866	1	2026-06-23 10:06:23.078486+00	0	1	healthy
867	5	2026-06-23 10:06:23.078486+00	0	1	healthy
868	2	2026-06-23 10:06:23.078486+00	0	1	healthy
869	3	2026-06-23 10:06:23.078486+00	0	1	healthy
870	4	2026-06-23 10:06:23.078486+00	0	1	healthy
871	1	2026-06-23 10:07:23.080279+00	0	1	healthy
872	5	2026-06-23 10:07:23.080279+00	0	1	healthy
873	2	2026-06-23 10:07:23.080279+00	0	1	healthy
874	3	2026-06-23 10:07:23.080279+00	0	1	healthy
875	4	2026-06-23 10:07:23.080279+00	0	1	healthy
876	1	2026-06-23 10:08:23.078674+00	0	1	healthy
877	5	2026-06-23 10:08:23.078674+00	0	1	healthy
878	2	2026-06-23 10:08:23.078674+00	0	1	healthy
879	3	2026-06-23 10:08:23.078674+00	0	1	healthy
880	4	2026-06-23 10:08:23.078674+00	0	1	healthy
881	1	2026-06-23 10:09:23.079229+00	0	1	healthy
882	5	2026-06-23 10:09:23.079229+00	0	1	healthy
883	2	2026-06-23 10:09:23.079229+00	0	1	healthy
884	3	2026-06-23 10:09:23.079229+00	0	1	healthy
885	4	2026-06-23 10:09:23.079229+00	0	1	healthy
886	1	2026-06-23 10:10:23.07857+00	0	1	healthy
887	5	2026-06-23 10:10:23.07857+00	0	1	healthy
888	2	2026-06-23 10:10:23.07857+00	0	1	healthy
889	3	2026-06-23 10:10:23.07857+00	0	1	healthy
890	4	2026-06-23 10:10:23.07857+00	0	1	healthy
891	1	2026-06-23 10:11:23.078328+00	0	1	healthy
892	5	2026-06-23 10:11:23.078328+00	0	1	healthy
893	2	2026-06-23 10:11:23.078328+00	0	1	healthy
894	3	2026-06-23 10:11:23.078328+00	0	1	healthy
895	4	2026-06-23 10:11:23.078328+00	0	1	healthy
896	1	2026-06-23 10:12:23.08064+00	0	1	healthy
897	5	2026-06-23 10:12:23.08064+00	0	1	healthy
898	2	2026-06-23 10:12:23.08064+00	0	1	healthy
899	3	2026-06-23 10:12:23.08064+00	0	1	healthy
900	4	2026-06-23 10:12:23.08064+00	0	1	healthy
901	1	2026-06-23 10:13:23.078678+00	0	1	healthy
902	5	2026-06-23 10:13:23.078678+00	0	1	healthy
903	2	2026-06-23 10:13:23.078678+00	0	1	healthy
904	3	2026-06-23 10:13:23.078678+00	0	1	healthy
905	4	2026-06-23 10:13:23.078678+00	0	1	healthy
906	1	2026-06-23 10:14:23.078411+00	0	1	healthy
907	5	2026-06-23 10:14:23.078411+00	0	1	healthy
908	2	2026-06-23 10:14:23.078411+00	0	1	healthy
909	3	2026-06-23 10:14:23.078411+00	0	1	healthy
910	4	2026-06-23 10:14:23.078411+00	0	1	healthy
911	1	2026-06-23 10:15:23.080129+00	0	1	healthy
912	5	2026-06-23 10:15:23.080129+00	0	1	healthy
913	2	2026-06-23 10:15:23.080129+00	0	1	healthy
914	3	2026-06-23 10:15:23.080129+00	0	1	healthy
915	4	2026-06-23 10:15:23.080129+00	0	1	healthy
916	1	2026-06-23 10:16:23.080173+00	0	1	healthy
917	5	2026-06-23 10:16:23.080173+00	0	1	healthy
918	2	2026-06-23 10:16:23.080173+00	0	1	healthy
919	3	2026-06-23 10:16:23.080173+00	0	1	healthy
920	4	2026-06-23 10:16:23.080173+00	0	1	healthy
921	1	2026-06-23 10:17:23.080014+00	0	1	healthy
922	5	2026-06-23 10:17:23.080014+00	0	1	healthy
923	2	2026-06-23 10:17:23.080014+00	0	1	healthy
924	3	2026-06-23 10:17:23.080014+00	0	1	healthy
925	4	2026-06-23 10:17:23.080014+00	0	1	healthy
926	1	2026-06-23 10:18:23.078285+00	0	1	healthy
927	5	2026-06-23 10:18:23.078285+00	0	1	healthy
928	2	2026-06-23 10:18:23.078285+00	0	1	healthy
929	3	2026-06-23 10:18:23.078285+00	0	1	healthy
930	4	2026-06-23 10:18:23.078285+00	0	1	healthy
931	1	2026-06-23 10:19:23.216043+00	0	1	healthy
932	5	2026-06-23 10:19:23.216043+00	0	1	healthy
933	2	2026-06-23 10:19:23.216043+00	0	1	healthy
934	3	2026-06-23 10:19:23.216043+00	0	1	healthy
935	4	2026-06-23 10:19:23.216043+00	0	1	healthy
936	1	2026-06-23 10:20:23.07932+00	0	1	healthy
937	5	2026-06-23 10:20:23.07932+00	0	1	healthy
938	2	2026-06-23 10:20:23.07932+00	0	1	healthy
939	3	2026-06-23 10:20:23.07932+00	0	1	healthy
940	4	2026-06-23 10:20:23.07932+00	0	1	healthy
941	1	2026-06-23 10:21:23.07953+00	0	1	healthy
942	5	2026-06-23 10:21:23.07953+00	0	1	healthy
943	2	2026-06-23 10:21:23.07953+00	0	1	healthy
944	3	2026-06-23 10:21:23.07953+00	0	1	healthy
945	4	2026-06-23 10:21:23.07953+00	0	1	healthy
946	1	2026-06-23 10:22:23.08523+00	0	1	healthy
947	5	2026-06-23 10:22:23.08523+00	0	1	healthy
948	2	2026-06-23 10:22:23.08523+00	0	1	healthy
949	3	2026-06-23 10:22:23.08523+00	0	1	healthy
950	4	2026-06-23 10:22:23.08523+00	0	1	healthy
951	1	2026-06-23 10:23:23.078266+00	0	1	healthy
952	5	2026-06-23 10:23:23.078266+00	0	1	healthy
953	2	2026-06-23 10:23:23.078266+00	0	1	healthy
954	3	2026-06-23 10:23:23.078266+00	0	1	healthy
955	4	2026-06-23 10:23:23.078266+00	0	1	healthy
956	1	2026-06-23 10:24:23.079189+00	0	1	healthy
957	5	2026-06-23 10:24:23.079189+00	0	1	healthy
958	2	2026-06-23 10:24:23.079189+00	0	1	healthy
959	3	2026-06-23 10:24:23.079189+00	0	1	healthy
960	4	2026-06-23 10:24:23.079189+00	0	1	healthy
961	1	2026-06-23 10:25:23.078318+00	0	1	healthy
962	5	2026-06-23 10:25:23.078318+00	0	1	healthy
963	2	2026-06-23 10:25:23.078318+00	0	1	healthy
964	3	2026-06-23 10:25:23.078318+00	0	1	healthy
965	4	2026-06-23 10:25:23.078318+00	0	1	healthy
966	1	2026-06-23 10:26:23.078823+00	0	1	healthy
967	5	2026-06-23 10:26:23.078823+00	0	1	healthy
968	2	2026-06-23 10:26:23.078823+00	0	1	healthy
969	3	2026-06-23 10:26:23.078823+00	0	1	healthy
970	4	2026-06-23 10:26:23.078823+00	0	1	healthy
971	1	2026-06-23 10:27:23.080111+00	0	1	healthy
972	5	2026-06-23 10:27:23.080111+00	0	1	healthy
973	2	2026-06-23 10:27:23.080111+00	0	1	healthy
974	3	2026-06-23 10:27:23.080111+00	0	1	healthy
975	4	2026-06-23 10:27:23.080111+00	0	1	healthy
981	1	2026-06-23 10:29:23.079101+00	0	1	healthy
982	5	2026-06-23 10:29:23.079101+00	0	1	healthy
983	2	2026-06-23 10:29:23.079101+00	0	1	healthy
984	3	2026-06-23 10:29:23.079101+00	0	1	healthy
985	4	2026-06-23 10:29:23.079101+00	0	1	healthy
1321	1	2026-06-23 13:49:23.080685+00	0	1	healthy
1322	5	2026-06-23 13:49:23.080685+00	0	1	healthy
1323	2	2026-06-23 13:49:23.080685+00	0	1	healthy
1324	3	2026-06-23 13:49:23.080685+00	0	1	healthy
1325	4	2026-06-23 13:49:23.080685+00	0	1	healthy
1336	1	2026-06-23 13:52:23.08602+00	0	1	healthy
1337	5	2026-06-23 13:52:23.08602+00	0	1	healthy
1338	2	2026-06-23 13:52:23.08602+00	0	1	healthy
1339	3	2026-06-23 13:52:23.08602+00	0	1	healthy
1340	4	2026-06-23 13:52:23.08602+00	0	1	healthy
1351	1	2026-06-23 13:55:23.080534+00	0	1	healthy
1352	5	2026-06-23 13:55:23.080534+00	0	1	healthy
1353	2	2026-06-23 13:55:23.080534+00	0	1	healthy
1354	3	2026-06-23 13:55:23.080534+00	0	1	healthy
1355	4	2026-06-23 13:55:23.080534+00	0	1	healthy
1366	1	2026-06-23 13:58:23.080634+00	0	1	healthy
1367	5	2026-06-23 13:58:23.080634+00	0	1	healthy
1368	2	2026-06-23 13:58:23.080634+00	0	1	healthy
1369	3	2026-06-23 13:58:23.080634+00	0	1	healthy
1370	4	2026-06-23 13:58:23.080634+00	0	1	healthy
1386	1	2026-06-23 14:02:23.08162+00	0	1	healthy
1387	5	2026-06-23 14:02:23.08162+00	0	1	healthy
1388	2	2026-06-23 14:02:23.08162+00	0	1	healthy
1389	3	2026-06-23 14:02:23.08162+00	0	1	healthy
1390	4	2026-06-23 14:02:23.08162+00	0	1	healthy
1406	1	2026-06-23 14:06:23.078888+00	0	1	healthy
1407	5	2026-06-23 14:06:23.078888+00	0	1	healthy
1408	2	2026-06-23 14:06:23.078888+00	0	1	healthy
1409	3	2026-06-23 14:06:23.078888+00	0	1	healthy
1410	4	2026-06-23 14:06:23.078888+00	0	1	healthy
1421	1	2026-06-23 14:39:23.082824+00	0	1	healthy
1422	5	2026-06-23 14:39:23.082824+00	0	1	healthy
1423	2	2026-06-23 14:39:23.082824+00	0	1	healthy
1424	3	2026-06-23 14:39:23.082824+00	0	1	healthy
1425	4	2026-06-23 14:39:23.082824+00	0	1	healthy
1451	1	2026-06-23 14:45:23.080234+00	0	1	healthy
1452	5	2026-06-23 14:45:23.080234+00	0	1	healthy
1453	2	2026-06-23 14:45:23.080234+00	0	1	healthy
1454	3	2026-06-23 14:45:23.080234+00	0	1	healthy
1455	4	2026-06-23 14:45:23.080234+00	0	1	healthy
1466	1	2026-06-23 14:48:23.080129+00	0	1	healthy
1467	5	2026-06-23 14:48:23.080129+00	0	1	healthy
1468	2	2026-06-23 14:48:23.080129+00	0	1	healthy
1469	3	2026-06-23 14:48:23.080129+00	0	1	healthy
1470	4	2026-06-23 14:48:23.080129+00	0	1	healthy
1661	1	2026-06-24 02:06:23.081103+00	0	1	healthy
1662	5	2026-06-24 02:06:23.081103+00	0	1	healthy
1663	2	2026-06-24 02:06:23.081103+00	0	1	healthy
1664	3	2026-06-24 02:06:23.081103+00	0	1	healthy
1665	4	2026-06-24 02:06:23.081103+00	0	1	healthy
1666	1	2026-06-24 02:07:23.080694+00	0	1	healthy
1667	5	2026-06-24 02:07:23.080694+00	0	1	healthy
1668	2	2026-06-24 02:07:23.080694+00	0	1	healthy
1669	3	2026-06-24 02:07:23.080694+00	0	1	healthy
1670	4	2026-06-24 02:07:23.080694+00	0	1	healthy
1686	1	2026-06-24 02:11:23.079629+00	0	1	healthy
1687	5	2026-06-24 02:11:23.079629+00	0	1	healthy
1688	2	2026-06-24 02:11:23.079629+00	0	1	healthy
1689	3	2026-06-24 02:11:23.079629+00	0	1	healthy
1690	4	2026-06-24 02:11:23.079629+00	0	1	healthy
1706	1	2026-06-24 02:15:23.078828+00	0	1	healthy
1707	5	2026-06-24 02:15:23.078828+00	0	1	healthy
1708	2	2026-06-24 02:15:23.078828+00	0	1	healthy
1709	3	2026-06-24 02:15:23.078828+00	0	1	healthy
1710	4	2026-06-24 02:15:23.078828+00	0	1	healthy
1781	1	2026-06-24 02:30:23.079407+00	0	1	healthy
1782	5	2026-06-24 02:30:23.079407+00	0	1	healthy
1783	2	2026-06-24 02:30:23.079407+00	0	1	healthy
1784	3	2026-06-24 02:30:23.079407+00	0	1	healthy
1785	4	2026-06-24 02:30:23.079407+00	0	1	healthy
1786	1	2026-06-24 02:31:23.079371+00	0	1	healthy
1787	5	2026-06-24 02:31:23.079371+00	0	1	healthy
1788	2	2026-06-24 02:31:23.079371+00	0	1	healthy
1789	3	2026-06-24 02:31:23.079371+00	0	1	healthy
1790	4	2026-06-24 02:31:23.079371+00	0	1	healthy
1791	1	2026-06-24 02:32:23.078541+00	0	1	healthy
1792	5	2026-06-24 02:32:23.078541+00	0	1	healthy
1793	2	2026-06-24 02:32:23.078541+00	0	1	healthy
1794	3	2026-06-24 02:32:23.078541+00	0	1	healthy
1795	4	2026-06-24 02:32:23.078541+00	0	1	healthy
1806	1	2026-06-24 02:35:23.079152+00	0	1	healthy
1807	5	2026-06-24 02:35:23.079152+00	0	1	healthy
1808	2	2026-06-24 02:35:23.079152+00	0	1	healthy
1809	3	2026-06-24 02:35:23.079152+00	0	1	healthy
1810	4	2026-06-24 02:35:23.079152+00	0	1	healthy
1821	1	2026-06-24 02:38:23.079697+00	0	1	healthy
1822	5	2026-06-24 02:38:23.079697+00	0	1	healthy
1823	2	2026-06-24 02:38:23.079697+00	0	1	healthy
1824	3	2026-06-24 02:38:23.079697+00	0	1	healthy
1825	4	2026-06-24 02:38:23.079697+00	0	1	healthy
1851	1	2026-06-24 02:44:23.079297+00	0	1	healthy
1852	5	2026-06-24 02:44:23.079297+00	0	1	healthy
1853	2	2026-06-24 02:44:23.079297+00	0	1	healthy
1854	3	2026-06-24 02:44:23.079297+00	0	1	healthy
1855	4	2026-06-24 02:44:23.079297+00	0	1	healthy
1866	1	2026-06-24 02:47:23.07912+00	0	1	healthy
1867	5	2026-06-24 02:47:23.07912+00	0	1	healthy
1868	2	2026-06-24 02:47:23.07912+00	0	1	healthy
1869	3	2026-06-24 02:47:23.07912+00	0	1	healthy
1870	4	2026-06-24 02:47:23.07912+00	0	1	healthy
1891	1	2026-06-24 02:52:23.081957+00	0	1	healthy
1892	5	2026-06-24 02:52:23.081957+00	0	1	healthy
1893	2	2026-06-24 02:52:23.081957+00	0	1	healthy
1894	3	2026-06-24 02:52:23.081957+00	0	1	healthy
1895	4	2026-06-24 02:52:23.081957+00	0	1	healthy
1956	1	2026-06-24 03:07:23.485778+00	0	1	healthy
1957	5	2026-06-24 03:07:23.485778+00	0	1	healthy
1958	2	2026-06-24 03:07:23.485778+00	0	1	healthy
1959	3	2026-06-24 03:07:23.485778+00	0	1	healthy
1960	4	2026-06-24 03:07:23.485778+00	0	1	healthy
976	1	2026-06-23 10:28:23.07892+00	0	1	healthy
977	5	2026-06-23 10:28:23.07892+00	0	1	healthy
978	2	2026-06-23 10:28:23.07892+00	0	1	healthy
979	3	2026-06-23 10:28:23.07892+00	0	1	healthy
980	4	2026-06-23 10:28:23.07892+00	0	1	healthy
986	1	2026-06-23 10:30:23.084611+00	0	1	healthy
987	5	2026-06-23 10:30:23.084611+00	0	1	healthy
988	2	2026-06-23 10:30:23.084611+00	0	1	healthy
989	3	2026-06-23 10:30:23.084611+00	0	1	healthy
990	4	2026-06-23 10:30:23.084611+00	0	1	healthy
1326	1	2026-06-23 13:50:23.080592+00	0	1	healthy
1327	5	2026-06-23 13:50:23.080592+00	0	1	healthy
1328	2	2026-06-23 13:50:23.080592+00	0	1	healthy
1329	3	2026-06-23 13:50:23.080592+00	0	1	healthy
1330	4	2026-06-23 13:50:23.080592+00	0	1	healthy
1341	1	2026-06-23 13:53:23.079829+00	0	1	healthy
1342	5	2026-06-23 13:53:23.079829+00	0	1	healthy
1343	2	2026-06-23 13:53:23.079829+00	0	1	healthy
1344	3	2026-06-23 13:53:23.079829+00	0	1	healthy
1345	4	2026-06-23 13:53:23.079829+00	0	1	healthy
1376	1	2026-06-23 14:00:23.079889+00	0	1	healthy
1377	5	2026-06-23 14:00:23.079889+00	0	1	healthy
1378	2	2026-06-23 14:00:23.079889+00	0	1	healthy
1379	3	2026-06-23 14:00:23.079889+00	0	1	healthy
1380	4	2026-06-23 14:00:23.079889+00	0	1	healthy
1411	1	2026-06-23 14:07:23.079667+00	0	1	healthy
1412	5	2026-06-23 14:07:23.079667+00	0	1	healthy
1413	2	2026-06-23 14:07:23.079667+00	0	1	healthy
1414	3	2026-06-23 14:07:23.079667+00	0	1	healthy
1415	4	2026-06-23 14:07:23.079667+00	0	1	healthy
1431	1	2026-06-23 14:41:23.080096+00	0	1	healthy
1432	5	2026-06-23 14:41:23.080096+00	0	1	healthy
1433	2	2026-06-23 14:41:23.080096+00	0	1	healthy
1434	3	2026-06-23 14:41:23.080096+00	0	1	healthy
1435	4	2026-06-23 14:41:23.080096+00	0	1	healthy
1441	1	2026-06-23 14:43:23.079861+00	0	1	healthy
1442	5	2026-06-23 14:43:23.079861+00	0	1	healthy
1443	2	2026-06-23 14:43:23.079861+00	0	1	healthy
1444	3	2026-06-23 14:43:23.079861+00	0	1	healthy
1445	4	2026-06-23 14:43:23.079861+00	0	1	healthy
1476	1	2026-06-23 14:51:23.079075+00	0	1	healthy
1477	5	2026-06-23 14:51:23.079075+00	0	1	healthy
1478	2	2026-06-23 14:51:23.079075+00	0	1	healthy
1479	3	2026-06-23 14:51:23.079075+00	0	1	healthy
1480	4	2026-06-23 14:51:23.079075+00	0	1	healthy
1491	1	2026-06-23 16:52:23.087933+00	0	1	healthy
1492	5	2026-06-23 16:52:23.087933+00	0	1	healthy
1493	2	2026-06-23 16:52:23.087933+00	0	1	healthy
1494	3	2026-06-23 16:52:23.087933+00	0	1	healthy
1495	4	2026-06-23 16:52:23.087933+00	0	1	healthy
1676	1	2026-06-24 02:09:23.08966+00	0	1	healthy
1677	5	2026-06-24 02:09:23.08966+00	0	1	healthy
1678	2	2026-06-24 02:09:23.08966+00	0	1	healthy
1679	3	2026-06-24 02:09:23.08966+00	0	1	healthy
1680	4	2026-06-24 02:09:23.08966+00	0	1	healthy
1681	1	2026-06-24 02:10:23.079284+00	0	1	healthy
1682	5	2026-06-24 02:10:23.079284+00	0	1	healthy
1683	2	2026-06-24 02:10:23.079284+00	0	1	healthy
1684	3	2026-06-24 02:10:23.079284+00	0	1	healthy
1685	4	2026-06-24 02:10:23.079284+00	0	1	healthy
1696	1	2026-06-24 02:13:23.078825+00	0	1	healthy
1697	5	2026-06-24 02:13:23.078825+00	0	1	healthy
1698	2	2026-06-24 02:13:23.078825+00	0	1	healthy
1699	3	2026-06-24 02:13:23.078825+00	0	1	healthy
1700	4	2026-06-24 02:13:23.078825+00	0	1	healthy
1701	1	2026-06-24 02:14:23.079193+00	0	1	healthy
1702	5	2026-06-24 02:14:23.079193+00	0	1	healthy
1703	2	2026-06-24 02:14:23.079193+00	0	1	healthy
1704	3	2026-06-24 02:14:23.079193+00	0	1	healthy
1705	4	2026-06-24 02:14:23.079193+00	0	1	healthy
1801	1	2026-06-24 02:34:23.078268+00	0	1	healthy
1802	5	2026-06-24 02:34:23.078268+00	0	1	healthy
1803	2	2026-06-24 02:34:23.078268+00	0	1	healthy
1804	3	2026-06-24 02:34:23.078268+00	0	1	healthy
1805	4	2026-06-24 02:34:23.078268+00	0	1	healthy
1811	1	2026-06-24 02:36:23.079282+00	0	1	healthy
1812	5	2026-06-24 02:36:23.079282+00	0	1	healthy
1813	2	2026-06-24 02:36:23.079282+00	0	1	healthy
1814	3	2026-06-24 02:36:23.079282+00	0	1	healthy
1815	4	2026-06-24 02:36:23.079282+00	0	1	healthy
1841	1	2026-06-24 02:42:23.085882+00	0	1	healthy
1842	5	2026-06-24 02:42:23.085882+00	0	1	healthy
1843	2	2026-06-24 02:42:23.085882+00	0	1	healthy
1844	3	2026-06-24 02:42:23.085882+00	0	1	healthy
1845	4	2026-06-24 02:42:23.085882+00	0	1	healthy
1881	1	2026-06-24 02:50:23.078601+00	0	1	healthy
1882	5	2026-06-24 02:50:23.078601+00	0	1	healthy
1883	2	2026-06-24 02:50:23.078601+00	0	1	healthy
1884	3	2026-06-24 02:50:23.078601+00	0	1	healthy
1885	4	2026-06-24 02:50:23.078601+00	0	1	healthy
1896	1	2026-06-24 02:53:23.079222+00	0	1	healthy
1897	5	2026-06-24 02:53:23.079222+00	0	1	healthy
1898	2	2026-06-24 02:53:23.079222+00	0	1	healthy
1899	3	2026-06-24 02:53:23.079222+00	0	1	healthy
1900	4	2026-06-24 02:53:23.079222+00	0	1	healthy
1906	1	2026-06-24 02:55:23.081146+00	0	1	healthy
1907	5	2026-06-24 02:55:23.081146+00	0	1	healthy
1908	2	2026-06-24 02:55:23.081146+00	0	1	healthy
1909	3	2026-06-24 02:55:23.081146+00	0	1	healthy
1910	4	2026-06-24 02:55:23.081146+00	0	1	healthy
1976	1	2026-06-24 03:11:23.0783+00	0	1	healthy
1977	5	2026-06-24 03:11:23.0783+00	0	1	healthy
1978	2	2026-06-24 03:11:23.0783+00	0	1	healthy
1979	3	2026-06-24 03:11:23.0783+00	0	1	healthy
1980	4	2026-06-24 03:11:23.0783+00	0	1	healthy
1991	1	2026-06-24 03:14:23.078248+00	0	1	healthy
1992	5	2026-06-24 03:14:23.078248+00	0	1	healthy
1993	2	2026-06-24 03:14:23.078248+00	0	1	healthy
1994	3	2026-06-24 03:14:23.078248+00	0	1	healthy
1995	4	2026-06-24 03:14:23.078248+00	0	1	healthy
2046	1	2026-06-24 03:25:23.080742+00	0	1	healthy
2047	5	2026-06-24 03:25:23.080742+00	0	1	healthy
2048	2	2026-06-24 03:25:23.080742+00	0	1	healthy
2049	3	2026-06-24 03:25:23.080742+00	0	1	healthy
2050	4	2026-06-24 03:25:23.080742+00	0	1	healthy
2061	1	2026-06-24 03:28:23.079333+00	0	1	healthy
2062	5	2026-06-24 03:28:23.079333+00	0	1	healthy
2063	2	2026-06-24 03:28:23.079333+00	0	1	healthy
2064	3	2026-06-24 03:28:23.079333+00	0	1	healthy
2065	4	2026-06-24 03:28:23.079333+00	0	1	healthy
991	1	2026-06-23 10:31:23.078895+00	0	1	healthy
992	5	2026-06-23 10:31:23.078895+00	0	1	healthy
993	2	2026-06-23 10:31:23.078895+00	0	1	healthy
994	3	2026-06-23 10:31:23.078895+00	0	1	healthy
995	4	2026-06-23 10:31:23.078895+00	0	1	healthy
996	1	2026-06-23 10:32:23.080335+00	0	1	healthy
997	5	2026-06-23 10:32:23.080335+00	0	1	healthy
998	2	2026-06-23 10:32:23.080335+00	0	1	healthy
999	3	2026-06-23 10:32:23.080335+00	0	1	healthy
1000	4	2026-06-23 10:32:23.080335+00	0	1	healthy
1001	1	2026-06-23 10:33:23.078915+00	0	1	healthy
1002	5	2026-06-23 10:33:23.078915+00	0	1	healthy
1003	2	2026-06-23 10:33:23.078915+00	0	1	healthy
1004	3	2026-06-23 10:33:23.078915+00	0	1	healthy
1005	4	2026-06-23 10:33:23.078915+00	0	1	healthy
1006	1	2026-06-23 10:34:23.154155+00	0	1	healthy
1007	5	2026-06-23 10:34:23.154155+00	0	1	healthy
1008	2	2026-06-23 10:34:23.154155+00	0	1	healthy
1009	3	2026-06-23 10:34:23.154155+00	0	1	healthy
1010	4	2026-06-23 10:34:23.154155+00	0	1	healthy
1011	1	2026-06-23 10:35:23.079478+00	0	1	healthy
1012	5	2026-06-23 10:35:23.079478+00	0	1	healthy
1013	2	2026-06-23 10:35:23.079478+00	0	1	healthy
1014	3	2026-06-23 10:35:23.079478+00	0	1	healthy
1015	4	2026-06-23 10:35:23.079478+00	0	1	healthy
1016	1	2026-06-23 10:36:23.078937+00	0	1	healthy
1017	5	2026-06-23 10:36:23.078937+00	0	1	healthy
1018	2	2026-06-23 10:36:23.078937+00	0	1	healthy
1019	3	2026-06-23 10:36:23.078937+00	0	1	healthy
1020	4	2026-06-23 10:36:23.078937+00	0	1	healthy
1021	1	2026-06-23 10:37:23.079524+00	0	1	healthy
1022	5	2026-06-23 10:37:23.079524+00	0	1	healthy
1023	2	2026-06-23 10:37:23.079524+00	0	1	healthy
1024	3	2026-06-23 10:37:23.079524+00	0	1	healthy
1025	4	2026-06-23 10:37:23.079524+00	0	1	healthy
1026	1	2026-06-23 10:38:23.078576+00	0	1	healthy
1027	5	2026-06-23 10:38:23.078576+00	0	1	healthy
1028	2	2026-06-23 10:38:23.078576+00	0	1	healthy
1029	3	2026-06-23 10:38:23.078576+00	0	1	healthy
1030	4	2026-06-23 10:38:23.078576+00	0	1	healthy
1031	1	2026-06-23 10:39:23.078563+00	0	1	healthy
1032	5	2026-06-23 10:39:23.078563+00	0	1	healthy
1033	2	2026-06-23 10:39:23.078563+00	0	1	healthy
1034	3	2026-06-23 10:39:23.078563+00	0	1	healthy
1035	4	2026-06-23 10:39:23.078563+00	0	1	healthy
1036	1	2026-06-23 10:40:23.078257+00	0	1	healthy
1037	5	2026-06-23 10:40:23.078257+00	0	1	healthy
1038	2	2026-06-23 10:40:23.078257+00	0	1	healthy
1039	3	2026-06-23 10:40:23.078257+00	0	1	healthy
1040	4	2026-06-23 10:40:23.078257+00	0	1	healthy
1041	1	2026-06-23 10:41:23.079888+00	0	1	healthy
1042	5	2026-06-23 10:41:23.079888+00	0	1	healthy
1043	2	2026-06-23 10:41:23.079888+00	0	1	healthy
1044	3	2026-06-23 10:41:23.079888+00	0	1	healthy
1045	4	2026-06-23 10:41:23.079888+00	0	1	healthy
1046	1	2026-06-23 10:42:23.080189+00	0	1	healthy
1047	5	2026-06-23 10:42:23.080189+00	0	1	healthy
1048	2	2026-06-23 10:42:23.080189+00	0	1	healthy
1049	3	2026-06-23 10:42:23.080189+00	0	1	healthy
1050	4	2026-06-23 10:42:23.080189+00	0	1	healthy
1051	1	2026-06-23 10:43:23.079255+00	0	1	healthy
1052	5	2026-06-23 10:43:23.079255+00	0	1	healthy
1053	2	2026-06-23 10:43:23.079255+00	0	1	healthy
1054	3	2026-06-23 10:43:23.079255+00	0	1	healthy
1055	4	2026-06-23 10:43:23.079255+00	0	1	healthy
1056	1	2026-06-23 10:44:23.079691+00	0	1	healthy
1057	5	2026-06-23 10:44:23.079691+00	0	1	healthy
1058	2	2026-06-23 10:44:23.079691+00	0	1	healthy
1059	3	2026-06-23 10:44:23.079691+00	0	1	healthy
1060	4	2026-06-23 10:44:23.079691+00	0	1	healthy
1061	1	2026-06-23 10:45:23.079229+00	0	1	healthy
1062	5	2026-06-23 10:45:23.079229+00	0	1	healthy
1063	2	2026-06-23 10:45:23.079229+00	0	1	healthy
1064	3	2026-06-23 10:45:23.079229+00	0	1	healthy
1065	4	2026-06-23 10:45:23.079229+00	0	1	healthy
1066	1	2026-06-23 10:46:23.078621+00	0	1	healthy
1067	5	2026-06-23 10:46:23.078621+00	0	1	healthy
1068	2	2026-06-23 10:46:23.078621+00	0	1	healthy
1069	3	2026-06-23 10:46:23.078621+00	0	1	healthy
1070	4	2026-06-23 10:46:23.078621+00	0	1	healthy
1071	1	2026-06-23 10:47:23.080954+00	0	1	healthy
1072	5	2026-06-23 10:47:23.080954+00	0	1	healthy
1073	2	2026-06-23 10:47:23.080954+00	0	1	healthy
1074	3	2026-06-23 10:47:23.080954+00	0	1	healthy
1075	4	2026-06-23 10:47:23.080954+00	0	1	healthy
1076	1	2026-06-23 10:48:23.078983+00	0	1	healthy
1077	5	2026-06-23 10:48:23.078983+00	0	1	healthy
1078	2	2026-06-23 10:48:23.078983+00	0	1	healthy
1079	3	2026-06-23 10:48:23.078983+00	0	1	healthy
1080	4	2026-06-23 10:48:23.078983+00	0	1	healthy
1081	1	2026-06-23 10:49:23.116369+00	0	1	healthy
1082	5	2026-06-23 10:49:23.116369+00	0	1	healthy
1083	2	2026-06-23 10:49:23.116369+00	0	1	healthy
1084	3	2026-06-23 10:49:23.116369+00	0	1	healthy
1085	4	2026-06-23 10:49:23.116369+00	0	1	healthy
1086	1	2026-06-23 10:50:23.081359+00	0	1	healthy
1087	5	2026-06-23 10:50:23.081359+00	0	1	healthy
1088	2	2026-06-23 10:50:23.081359+00	0	1	healthy
1089	3	2026-06-23 10:50:23.081359+00	0	1	healthy
1090	4	2026-06-23 10:50:23.081359+00	0	1	healthy
1091	1	2026-06-23 10:51:23.079984+00	0	1	healthy
1092	5	2026-06-23 10:51:23.079984+00	0	1	healthy
1093	2	2026-06-23 10:51:23.079984+00	0	1	healthy
1094	3	2026-06-23 10:51:23.079984+00	0	1	healthy
1095	4	2026-06-23 10:51:23.079984+00	0	1	healthy
1096	1	2026-06-23 10:52:23.081445+00	0	1	healthy
1097	5	2026-06-23 10:52:23.081445+00	0	1	healthy
1098	2	2026-06-23 10:52:23.081445+00	0	1	healthy
1099	3	2026-06-23 10:52:23.081445+00	0	1	healthy
1100	4	2026-06-23 10:52:23.081445+00	0	1	healthy
1101	1	2026-06-23 10:53:23.079323+00	0	1	healthy
1102	5	2026-06-23 10:53:23.079323+00	0	1	healthy
1103	2	2026-06-23 10:53:23.079323+00	0	1	healthy
1104	3	2026-06-23 10:53:23.079323+00	0	1	healthy
1105	4	2026-06-23 10:53:23.079323+00	0	1	healthy
1106	1	2026-06-23 10:54:23.079454+00	0	1	healthy
1107	5	2026-06-23 10:54:23.079454+00	0	1	healthy
1108	2	2026-06-23 10:54:23.079454+00	0	1	healthy
1109	3	2026-06-23 10:54:23.079454+00	0	1	healthy
1110	4	2026-06-23 10:54:23.079454+00	0	1	healthy
1111	1	2026-06-23 10:55:23.081385+00	0	1	healthy
1112	5	2026-06-23 10:55:23.081385+00	0	1	healthy
1113	2	2026-06-23 10:55:23.081385+00	0	1	healthy
1114	3	2026-06-23 10:55:23.081385+00	0	1	healthy
1115	4	2026-06-23 10:55:23.081385+00	0	1	healthy
1131	1	2026-06-23 10:59:23.080659+00	0	1	healthy
1132	5	2026-06-23 10:59:23.080659+00	0	1	healthy
1133	2	2026-06-23 10:59:23.080659+00	0	1	healthy
1134	3	2026-06-23 10:59:23.080659+00	0	1	healthy
1135	4	2026-06-23 10:59:23.080659+00	0	1	healthy
1331	1	2026-06-23 13:51:23.081059+00	0	1	healthy
1332	5	2026-06-23 13:51:23.081059+00	0	1	healthy
1333	2	2026-06-23 13:51:23.081059+00	0	1	healthy
1334	3	2026-06-23 13:51:23.081059+00	0	1	healthy
1335	4	2026-06-23 13:51:23.081059+00	0	1	healthy
1361	1	2026-06-23 13:57:23.082331+00	0	1	healthy
1362	5	2026-06-23 13:57:23.082331+00	0	1	healthy
1363	2	2026-06-23 13:57:23.082331+00	0	1	healthy
1364	3	2026-06-23 13:57:23.082331+00	0	1	healthy
1365	4	2026-06-23 13:57:23.082331+00	0	1	healthy
1381	1	2026-06-23 14:01:23.07962+00	0	1	healthy
1382	5	2026-06-23 14:01:23.07962+00	0	1	healthy
1383	2	2026-06-23 14:01:23.07962+00	0	1	healthy
1384	3	2026-06-23 14:01:23.07962+00	0	1	healthy
1385	4	2026-06-23 14:01:23.07962+00	0	1	healthy
1391	1	2026-06-23 14:03:23.078461+00	0	1	healthy
1392	5	2026-06-23 14:03:23.078461+00	0	1	healthy
1393	2	2026-06-23 14:03:23.078461+00	0	1	healthy
1394	3	2026-06-23 14:03:23.078461+00	0	1	healthy
1395	4	2026-06-23 14:03:23.078461+00	0	1	healthy
1426	1	2026-06-23 14:40:23.080829+00	0	1	healthy
1427	5	2026-06-23 14:40:23.080829+00	0	1	healthy
1428	2	2026-06-23 14:40:23.080829+00	0	1	healthy
1429	3	2026-06-23 14:40:23.080829+00	0	1	healthy
1430	4	2026-06-23 14:40:23.080829+00	0	1	healthy
1461	1	2026-06-23 14:47:23.083312+00	0	1	healthy
1462	5	2026-06-23 14:47:23.083312+00	0	1	healthy
1463	2	2026-06-23 14:47:23.083312+00	0	1	healthy
1464	3	2026-06-23 14:47:23.083312+00	0	1	healthy
1465	4	2026-06-23 14:47:23.083312+00	0	1	healthy
1481	1	2026-06-23 15:08:23.09053+00	0	1	healthy
1482	5	2026-06-23 15:08:23.09053+00	0	1	healthy
1483	2	2026-06-23 15:08:23.09053+00	0	1	healthy
1484	3	2026-06-23 15:08:23.09053+00	0	1	healthy
1485	4	2026-06-23 15:08:23.09053+00	0	1	healthy
1496	1	2026-06-23 17:26:23.079762+00	0	1	healthy
1497	5	2026-06-23 17:26:23.079762+00	0	1	healthy
1498	2	2026-06-23 17:26:23.079762+00	0	1	healthy
1499	3	2026-06-23 17:26:23.079762+00	0	1	healthy
1500	4	2026-06-23 17:26:23.079762+00	0	1	healthy
1711	1	2026-06-24 02:16:23.078593+00	0	1	healthy
1712	5	2026-06-24 02:16:23.078593+00	0	1	healthy
1713	2	2026-06-24 02:16:23.078593+00	0	1	healthy
1714	3	2026-06-24 02:16:23.078593+00	0	1	healthy
1715	4	2026-06-24 02:16:23.078593+00	0	1	healthy
1726	1	2026-06-24 02:19:23.079278+00	0	1	healthy
1727	5	2026-06-24 02:19:23.079278+00	0	1	healthy
1728	2	2026-06-24 02:19:23.079278+00	0	1	healthy
1729	3	2026-06-24 02:19:23.079278+00	0	1	healthy
1730	4	2026-06-24 02:19:23.079278+00	0	1	healthy
1816	1	2026-06-24 02:37:23.079872+00	0	1	healthy
1817	5	2026-06-24 02:37:23.079872+00	0	1	healthy
1818	2	2026-06-24 02:37:23.079872+00	0	1	healthy
1819	3	2026-06-24 02:37:23.079872+00	0	1	healthy
1820	4	2026-06-24 02:37:23.079872+00	0	1	healthy
1846	1	2026-06-24 02:43:23.0801+00	0	1	healthy
1847	5	2026-06-24 02:43:23.0801+00	0	1	healthy
1848	2	2026-06-24 02:43:23.0801+00	0	1	healthy
1849	3	2026-06-24 02:43:23.0801+00	0	1	healthy
1850	4	2026-06-24 02:43:23.0801+00	0	1	healthy
1901	1	2026-06-24 02:54:23.123687+00	0	1	healthy
1902	5	2026-06-24 02:54:23.123687+00	0	1	healthy
1903	2	2026-06-24 02:54:23.123687+00	0	1	healthy
1904	3	2026-06-24 02:54:23.123687+00	0	1	healthy
1905	4	2026-06-24 02:54:23.123687+00	0	1	healthy
2006	1	2026-06-24 03:17:23.078417+00	0	1	healthy
2007	5	2026-06-24 03:17:23.078417+00	0	1	healthy
2008	2	2026-06-24 03:17:23.078417+00	0	1	healthy
2009	3	2026-06-24 03:17:23.078417+00	0	1	healthy
2010	4	2026-06-24 03:17:23.078417+00	0	1	healthy
2021	1	2026-06-24 03:20:23.079311+00	0	1	healthy
2022	5	2026-06-24 03:20:23.079311+00	0	1	healthy
2023	2	2026-06-24 03:20:23.079311+00	0	1	healthy
2024	3	2026-06-24 03:20:23.079311+00	0	1	healthy
2025	4	2026-06-24 03:20:23.079311+00	0	1	healthy
2051	1	2026-06-24 03:26:23.089442+00	0	1	healthy
2052	5	2026-06-24 03:26:23.089442+00	0	1	healthy
2053	2	2026-06-24 03:26:23.089442+00	0	1	healthy
2054	3	2026-06-24 03:26:23.089442+00	0	1	healthy
2055	4	2026-06-24 03:26:23.089442+00	0	1	healthy
2066	1	2026-06-24 03:29:23.078198+00	0	1	healthy
2067	5	2026-06-24 03:29:23.078198+00	0	1	healthy
2068	2	2026-06-24 03:29:23.078198+00	0	1	healthy
2069	3	2026-06-24 03:29:23.078198+00	0	1	healthy
2070	4	2026-06-24 03:29:23.078198+00	0	1	healthy
2146	1	2026-06-24 03:47:05.908348+00	0	1	healthy
2147	5	2026-06-24 03:47:05.908348+00	0	1	healthy
2148	2	2026-06-24 03:47:05.908348+00	0	1	healthy
2149	3	2026-06-24 03:47:05.908348+00	0	1	healthy
2150	4	2026-06-24 03:47:05.908348+00	0	1	healthy
2156	1	2026-06-24 03:49:05.908385+00	0	1	healthy
2157	5	2026-06-24 03:49:05.908385+00	0	1	healthy
2158	2	2026-06-24 03:49:05.908385+00	0	1	healthy
2159	3	2026-06-24 03:49:05.908385+00	0	1	healthy
2160	4	2026-06-24 03:49:05.908385+00	0	1	healthy
2191	1	2026-06-24 03:56:05.907973+00	0	1	healthy
2192	5	2026-06-24 03:56:05.907973+00	0	1	healthy
2193	2	2026-06-24 03:56:05.907973+00	0	1	healthy
2194	3	2026-06-24 03:56:05.907973+00	0	1	healthy
2195	4	2026-06-24 03:56:05.907973+00	0	1	healthy
2206	1	2026-06-24 03:59:05.907704+00	0	1	healthy
2207	5	2026-06-24 03:59:05.907704+00	0	1	healthy
2208	2	2026-06-24 03:59:05.907704+00	0	1	healthy
2209	3	2026-06-24 03:59:05.907704+00	0	1	healthy
2210	4	2026-06-24 03:59:05.907704+00	0	1	healthy
2216	1	2026-06-24 04:01:05.908487+00	0	1	healthy
2217	5	2026-06-24 04:01:05.908487+00	0	1	healthy
2218	2	2026-06-24 04:01:05.908487+00	0	1	healthy
2219	3	2026-06-24 04:01:05.908487+00	0	1	healthy
2220	4	2026-06-24 04:01:05.908487+00	0	1	healthy
1116	1	2026-06-23 10:56:23.07891+00	0	1	healthy
1117	5	2026-06-23 10:56:23.07891+00	0	1	healthy
1118	2	2026-06-23 10:56:23.07891+00	0	1	healthy
1119	3	2026-06-23 10:56:23.07891+00	0	1	healthy
1120	4	2026-06-23 10:56:23.07891+00	0	1	healthy
1121	1	2026-06-23 10:57:23.081259+00	0	1	healthy
1122	5	2026-06-23 10:57:23.081259+00	0	1	healthy
1123	2	2026-06-23 10:57:23.081259+00	0	1	healthy
1124	3	2026-06-23 10:57:23.081259+00	0	1	healthy
1125	4	2026-06-23 10:57:23.081259+00	0	1	healthy
1141	1	2026-06-23 11:01:23.079054+00	0	1	healthy
1142	5	2026-06-23 11:01:23.079054+00	0	1	healthy
1143	2	2026-06-23 11:01:23.079054+00	0	1	healthy
1144	3	2026-06-23 11:01:23.079054+00	0	1	healthy
1145	4	2026-06-23 11:01:23.079054+00	0	1	healthy
1346	1	2026-06-23 13:54:23.079976+00	0	1	healthy
1347	5	2026-06-23 13:54:23.079976+00	0	1	healthy
1348	2	2026-06-23 13:54:23.079976+00	0	1	healthy
1349	3	2026-06-23 13:54:23.079976+00	0	1	healthy
1350	4	2026-06-23 13:54:23.079976+00	0	1	healthy
1396	1	2026-06-23 14:04:23.079464+00	0	1	healthy
1397	5	2026-06-23 14:04:23.079464+00	0	1	healthy
1398	2	2026-06-23 14:04:23.079464+00	0	1	healthy
1399	3	2026-06-23 14:04:23.079464+00	0	1	healthy
1400	4	2026-06-23 14:04:23.079464+00	0	1	healthy
1446	1	2026-06-23 14:44:23.080904+00	0	1	healthy
1447	5	2026-06-23 14:44:23.080904+00	0	1	healthy
1448	2	2026-06-23 14:44:23.080904+00	0	1	healthy
1449	3	2026-06-23 14:44:23.080904+00	0	1	healthy
1450	4	2026-06-23 14:44:23.080904+00	0	1	healthy
1486	1	2026-06-23 16:33:23.080348+00	0	1	healthy
1487	5	2026-06-23 16:33:23.080348+00	0	1	healthy
1488	2	2026-06-23 16:33:23.080348+00	0	1	healthy
1489	3	2026-06-23 16:33:23.080348+00	0	1	healthy
1490	4	2026-06-23 16:33:23.080348+00	0	1	healthy
1716	1	2026-06-24 02:17:23.080553+00	0	1	healthy
1717	5	2026-06-24 02:17:23.080553+00	0	1	healthy
1718	2	2026-06-24 02:17:23.080553+00	0	1	healthy
1719	3	2026-06-24 02:17:23.080553+00	0	1	healthy
1720	4	2026-06-24 02:17:23.080553+00	0	1	healthy
1751	1	2026-06-24 02:24:23.268771+00	0	1	healthy
1752	5	2026-06-24 02:24:23.268771+00	0	1	healthy
1753	2	2026-06-24 02:24:23.268771+00	0	1	healthy
1754	3	2026-06-24 02:24:23.268771+00	0	1	healthy
1755	4	2026-06-24 02:24:23.268771+00	0	1	healthy
1911	1	2026-06-24 02:56:23.079724+00	0	1	healthy
1912	5	2026-06-24 02:56:23.079724+00	0	1	healthy
1913	2	2026-06-24 02:56:23.079724+00	0	1	healthy
1914	3	2026-06-24 02:56:23.079724+00	0	1	healthy
1915	4	2026-06-24 02:56:23.079724+00	0	1	healthy
2056	1	2026-06-24 03:27:23.080618+00	0	1	healthy
2057	5	2026-06-24 03:27:23.080618+00	0	1	healthy
2058	2	2026-06-24 03:27:23.080618+00	0	1	healthy
2059	3	2026-06-24 03:27:23.080618+00	0	1	healthy
2060	4	2026-06-24 03:27:23.080618+00	0	1	healthy
2076	1	2026-06-24 03:31:23.081631+00	0	1	healthy
2077	5	2026-06-24 03:31:23.081631+00	0	1	healthy
2078	2	2026-06-24 03:31:23.081631+00	0	1	healthy
2079	3	2026-06-24 03:31:23.081631+00	0	1	healthy
2080	4	2026-06-24 03:31:23.081631+00	0	1	healthy
2161	1	2026-06-24 03:50:05.907742+00	0	1	healthy
2162	5	2026-06-24 03:50:05.907742+00	0	1	healthy
2163	2	2026-06-24 03:50:05.907742+00	0	1	healthy
2164	3	2026-06-24 03:50:05.907742+00	0	1	healthy
2165	4	2026-06-24 03:50:05.907742+00	0	1	healthy
2176	1	2026-06-24 03:53:05.909763+00	0	1	healthy
2177	5	2026-06-24 03:53:05.909763+00	0	1	healthy
2178	2	2026-06-24 03:53:05.909763+00	0	1	healthy
2179	3	2026-06-24 03:53:05.909763+00	0	1	healthy
2180	4	2026-06-24 03:53:05.909763+00	0	1	healthy
2196	1	2026-06-24 03:57:05.908213+00	0	1	healthy
2197	5	2026-06-24 03:57:05.908213+00	0	1	healthy
2198	2	2026-06-24 03:57:05.908213+00	0	1	healthy
2199	3	2026-06-24 03:57:05.908213+00	0	1	healthy
2200	4	2026-06-24 03:57:05.908213+00	0	1	healthy
2231	1	2026-06-24 04:04:05.907447+00	0	1	healthy
2232	5	2026-06-24 04:04:05.907447+00	0	1	healthy
2233	2	2026-06-24 04:04:05.907447+00	0	1	healthy
2234	3	2026-06-24 04:04:05.907447+00	0	1	healthy
2235	4	2026-06-24 04:04:05.907447+00	0	1	healthy
2241	1	2026-06-24 04:06:05.932632+00	0	1	healthy
2242	5	2026-06-24 04:06:05.932632+00	0	1	healthy
2243	2	2026-06-24 04:06:05.932632+00	0	1	healthy
2244	3	2026-06-24 04:06:05.932632+00	0	1	healthy
2245	4	2026-06-24 04:06:05.932632+00	0	1	healthy
2246	1	2026-06-24 04:07:05.924996+00	0	1	healthy
2247	5	2026-06-24 04:07:05.924996+00	0	1	healthy
2248	2	2026-06-24 04:07:05.924996+00	0	1	healthy
2249	3	2026-06-24 04:07:05.924996+00	0	1	healthy
2250	4	2026-06-24 04:07:05.924996+00	0	1	healthy
2251	1	2026-06-24 04:08:05.909665+00	0	1	healthy
2252	5	2026-06-24 04:08:05.909665+00	0	1	healthy
2253	2	2026-06-24 04:08:05.909665+00	0	1	healthy
2254	3	2026-06-24 04:08:05.909665+00	0	1	healthy
2255	4	2026-06-24 04:08:05.909665+00	0	1	healthy
2256	1	2026-06-24 04:09:05.908671+00	0	1	healthy
2257	5	2026-06-24 04:09:05.908671+00	0	1	healthy
2258	2	2026-06-24 04:09:05.908671+00	0	1	healthy
2259	3	2026-06-24 04:09:05.908671+00	0	1	healthy
2260	4	2026-06-24 04:09:05.908671+00	0	1	healthy
2261	1	2026-06-24 04:10:05.907887+00	0	1	healthy
2262	5	2026-06-24 04:10:05.907887+00	0	1	healthy
2263	2	2026-06-24 04:10:05.907887+00	0	1	healthy
2264	3	2026-06-24 04:10:05.907887+00	0	1	healthy
2265	4	2026-06-24 04:10:05.907887+00	0	1	healthy
2266	1	2026-06-24 04:11:05.907723+00	0	1	healthy
2267	5	2026-06-24 04:11:05.907723+00	0	1	healthy
2268	2	2026-06-24 04:11:05.907723+00	0	1	healthy
2269	3	2026-06-24 04:11:05.907723+00	0	1	healthy
2270	4	2026-06-24 04:11:05.907723+00	0	1	healthy
2271	1	2026-06-24 04:12:16.755036+00	0	1	healthy
2272	5	2026-06-24 04:12:16.755036+00	0	1	healthy
2273	2	2026-06-24 04:12:16.755036+00	0	1	healthy
2274	3	2026-06-24 04:12:16.755036+00	0	1	healthy
2275	4	2026-06-24 04:12:16.755036+00	0	1	healthy
2276	1	2026-06-24 04:13:16.706877+00	0	1	healthy
2277	5	2026-06-24 04:13:16.706877+00	0	1	healthy
2278	2	2026-06-24 04:13:16.706877+00	0	1	healthy
2279	3	2026-06-24 04:13:16.706877+00	0	1	healthy
2280	4	2026-06-24 04:13:16.706877+00	0	1	healthy
1126	1	2026-06-23 10:58:23.078692+00	0	1	healthy
1127	5	2026-06-23 10:58:23.078692+00	0	1	healthy
1128	2	2026-06-23 10:58:23.078692+00	0	1	healthy
1129	3	2026-06-23 10:58:23.078692+00	0	1	healthy
1130	4	2026-06-23 10:58:23.078692+00	0	1	healthy
1356	1	2026-06-23 13:56:23.080253+00	0	1	healthy
1357	5	2026-06-23 13:56:23.080253+00	0	1	healthy
1358	2	2026-06-23 13:56:23.080253+00	0	1	healthy
1359	3	2026-06-23 13:56:23.080253+00	0	1	healthy
1360	4	2026-06-23 13:56:23.080253+00	0	1	healthy
1371	1	2026-06-23 13:59:23.08067+00	0	1	healthy
1372	5	2026-06-23 13:59:23.08067+00	0	1	healthy
1373	2	2026-06-23 13:59:23.08067+00	0	1	healthy
1374	3	2026-06-23 13:59:23.08067+00	0	1	healthy
1375	4	2026-06-23 13:59:23.08067+00	0	1	healthy
1401	1	2026-06-23 14:05:23.078651+00	0	1	healthy
1402	5	2026-06-23 14:05:23.078651+00	0	1	healthy
1403	2	2026-06-23 14:05:23.078651+00	0	1	healthy
1404	3	2026-06-23 14:05:23.078651+00	0	1	healthy
1405	4	2026-06-23 14:05:23.078651+00	0	1	healthy
1416	1	2026-06-23 14:38:23.080409+00	0	1	healthy
1417	5	2026-06-23 14:38:23.080409+00	0	1	healthy
1418	2	2026-06-23 14:38:23.080409+00	0	1	healthy
1419	3	2026-06-23 14:38:23.080409+00	0	1	healthy
1420	4	2026-06-23 14:38:23.080409+00	0	1	healthy
1436	1	2026-06-23 14:42:23.084286+00	0	1	healthy
1437	5	2026-06-23 14:42:23.084286+00	0	1	healthy
1438	2	2026-06-23 14:42:23.084286+00	0	1	healthy
1439	3	2026-06-23 14:42:23.084286+00	0	1	healthy
1440	4	2026-06-23 14:42:23.084286+00	0	1	healthy
1456	1	2026-06-23 14:46:23.079146+00	0	1	healthy
1457	5	2026-06-23 14:46:23.079146+00	0	1	healthy
1458	2	2026-06-23 14:46:23.079146+00	0	1	healthy
1459	3	2026-06-23 14:46:23.079146+00	0	1	healthy
1460	4	2026-06-23 14:46:23.079146+00	0	1	healthy
1471	1	2026-06-23 14:50:23.080996+00	0	1	healthy
1472	5	2026-06-23 14:50:23.080996+00	0	1	healthy
1473	2	2026-06-23 14:50:23.080996+00	0	1	healthy
1474	3	2026-06-23 14:50:23.080996+00	0	1	healthy
1475	4	2026-06-23 14:50:23.080996+00	0	1	healthy
1501	1	2026-06-23 18:16:23.082032+00	0	1	healthy
1502	5	2026-06-23 18:16:23.082032+00	0	1	healthy
1503	2	2026-06-23 18:16:23.082032+00	0	1	healthy
1504	3	2026-06-23 18:16:23.082032+00	0	1	healthy
1505	4	2026-06-23 18:16:23.082032+00	0	1	healthy
1721	1	2026-06-24 02:18:23.079737+00	0	1	healthy
1722	5	2026-06-24 02:18:23.079737+00	0	1	healthy
1723	2	2026-06-24 02:18:23.079737+00	0	1	healthy
1724	3	2026-06-24 02:18:23.079737+00	0	1	healthy
1725	4	2026-06-24 02:18:23.079737+00	0	1	healthy
1746	1	2026-06-24 02:23:23.079224+00	0	1	healthy
1747	5	2026-06-24 02:23:23.079224+00	0	1	healthy
1748	2	2026-06-24 02:23:23.079224+00	0	1	healthy
1749	3	2026-06-24 02:23:23.079224+00	0	1	healthy
1750	4	2026-06-24 02:23:23.079224+00	0	1	healthy
1831	1	2026-06-24 02:40:23.078813+00	0	1	healthy
1832	5	2026-06-24 02:40:23.078813+00	0	1	healthy
1833	2	2026-06-24 02:40:23.078813+00	0	1	healthy
1834	3	2026-06-24 02:40:23.078813+00	0	1	healthy
1835	4	2026-06-24 02:40:23.078813+00	0	1	healthy
1861	1	2026-06-24 02:46:23.079421+00	0	1	healthy
1862	5	2026-06-24 02:46:23.079421+00	0	1	healthy
1863	2	2026-06-24 02:46:23.079421+00	0	1	healthy
1864	3	2026-06-24 02:46:23.079421+00	0	1	healthy
1865	4	2026-06-24 02:46:23.079421+00	0	1	healthy
1876	1	2026-06-24 02:49:23.078509+00	0	1	healthy
1877	5	2026-06-24 02:49:23.078509+00	0	1	healthy
1878	2	2026-06-24 02:49:23.078509+00	0	1	healthy
1879	3	2026-06-24 02:49:23.078509+00	0	1	healthy
1880	4	2026-06-24 02:49:23.078509+00	0	1	healthy
1916	1	2026-06-24 02:57:23.079956+00	0	1	healthy
1917	5	2026-06-24 02:57:23.079956+00	0	1	healthy
1918	2	2026-06-24 02:57:23.079956+00	0	1	healthy
1919	3	2026-06-24 02:57:23.079956+00	0	1	healthy
1920	4	2026-06-24 02:57:23.079956+00	0	1	healthy
1921	1	2026-06-24 02:58:23.094595+00	0	1	healthy
1922	5	2026-06-24 02:58:23.094595+00	0	1	healthy
1923	2	2026-06-24 02:58:23.094595+00	0	1	healthy
1924	3	2026-06-24 02:58:23.094595+00	0	1	healthy
1925	4	2026-06-24 02:58:23.094595+00	0	1	healthy
1931	1	2026-06-24 03:00:23.078759+00	0	1	healthy
1932	5	2026-06-24 03:00:23.078759+00	0	1	healthy
1933	2	2026-06-24 03:00:23.078759+00	0	1	healthy
1934	3	2026-06-24 03:00:23.078759+00	0	1	healthy
1935	4	2026-06-24 03:00:23.078759+00	0	1	healthy
2081	1	2026-06-24 03:32:23.082102+00	0	1	healthy
2082	5	2026-06-24 03:32:23.082102+00	0	1	healthy
2083	2	2026-06-24 03:32:23.082102+00	0	1	healthy
2084	3	2026-06-24 03:32:23.082102+00	0	1	healthy
2085	4	2026-06-24 03:32:23.082102+00	0	1	healthy
2181	1	2026-06-24 03:54:05.908695+00	0	1	healthy
2182	5	2026-06-24 03:54:05.908695+00	0	1	healthy
2183	2	2026-06-24 03:54:05.908695+00	0	1	healthy
2184	3	2026-06-24 03:54:05.908695+00	0	1	healthy
2185	4	2026-06-24 03:54:05.908695+00	0	1	healthy
2201	1	2026-06-24 03:58:05.908096+00	0	1	healthy
2202	5	2026-06-24 03:58:05.908096+00	0	1	healthy
2203	2	2026-06-24 03:58:05.908096+00	0	1	healthy
2204	3	2026-06-24 03:58:05.908096+00	0	1	healthy
2205	4	2026-06-24 03:58:05.908096+00	0	1	healthy
2211	1	2026-06-24 04:00:05.908555+00	0	1	healthy
2212	5	2026-06-24 04:00:05.908555+00	0	1	healthy
2213	2	2026-06-24 04:00:05.908555+00	0	1	healthy
2214	3	2026-06-24 04:00:05.908555+00	0	1	healthy
2215	4	2026-06-24 04:00:05.908555+00	0	1	healthy
2221	1	2026-06-24 04:02:05.91176+00	0	1	healthy
2222	5	2026-06-24 04:02:05.91176+00	0	1	healthy
2223	2	2026-06-24 04:02:05.91176+00	0	1	healthy
2224	3	2026-06-24 04:02:05.91176+00	0	1	healthy
2225	4	2026-06-24 04:02:05.91176+00	0	1	healthy
2226	1	2026-06-24 04:03:05.91003+00	0	1	healthy
2227	5	2026-06-24 04:03:05.91003+00	0	1	healthy
2228	2	2026-06-24 04:03:05.91003+00	0	1	healthy
2229	3	2026-06-24 04:03:05.91003+00	0	1	healthy
2230	4	2026-06-24 04:03:05.91003+00	0	1	healthy
2236	1	2026-06-24 04:05:05.908197+00	0	1	healthy
2237	5	2026-06-24 04:05:05.908197+00	0	1	healthy
2238	2	2026-06-24 04:05:05.908197+00	0	1	healthy
2239	3	2026-06-24 04:05:05.908197+00	0	1	healthy
2240	4	2026-06-24 04:05:05.908197+00	0	1	healthy
1136	1	2026-06-23 11:00:23.080011+00	0	1	healthy
1137	5	2026-06-23 11:00:23.080011+00	0	1	healthy
1138	2	2026-06-23 11:00:23.080011+00	0	1	healthy
1139	3	2026-06-23 11:00:23.080011+00	0	1	healthy
1140	4	2026-06-23 11:00:23.080011+00	0	1	healthy
1146	1	2026-06-23 11:02:23.081357+00	0	1	healthy
1147	5	2026-06-23 11:02:23.081357+00	0	1	healthy
1148	2	2026-06-23 11:02:23.081357+00	0	1	healthy
1149	3	2026-06-23 11:02:23.081357+00	0	1	healthy
1150	4	2026-06-23 11:02:23.081357+00	0	1	healthy
1151	1	2026-06-23 11:03:23.079383+00	0	1	healthy
1152	5	2026-06-23 11:03:23.079383+00	0	1	healthy
1153	2	2026-06-23 11:03:23.079383+00	0	1	healthy
1154	3	2026-06-23 11:03:23.079383+00	0	1	healthy
1155	4	2026-06-23 11:03:23.079383+00	0	1	healthy
1156	1	2026-06-23 11:04:23.118251+00	0	1	healthy
1157	5	2026-06-23 11:04:23.118251+00	0	1	healthy
1158	2	2026-06-23 11:04:23.118251+00	0	1	healthy
1159	3	2026-06-23 11:04:23.118251+00	0	1	healthy
1160	4	2026-06-23 11:04:23.118251+00	0	1	healthy
1161	1	2026-06-23 11:05:23.082497+00	0	1	healthy
1162	5	2026-06-23 11:05:23.082497+00	0	1	healthy
1163	2	2026-06-23 11:05:23.082497+00	0	1	healthy
1164	3	2026-06-23 11:05:23.082497+00	0	1	healthy
1165	4	2026-06-23 11:05:23.082497+00	0	1	healthy
1166	1	2026-06-23 11:06:23.079528+00	0	1	healthy
1167	5	2026-06-23 11:06:23.079528+00	0	1	healthy
1168	2	2026-06-23 11:06:23.079528+00	0	1	healthy
1169	3	2026-06-23 11:06:23.079528+00	0	1	healthy
1170	4	2026-06-23 11:06:23.079528+00	0	1	healthy
1171	1	2026-06-23 11:07:23.081618+00	0	1	healthy
1172	5	2026-06-23 11:07:23.081618+00	0	1	healthy
1173	2	2026-06-23 11:07:23.081618+00	0	1	healthy
1174	3	2026-06-23 11:07:23.081618+00	0	1	healthy
1175	4	2026-06-23 11:07:23.081618+00	0	1	healthy
1176	1	2026-06-23 11:08:23.081074+00	0	1	healthy
1177	5	2026-06-23 11:08:23.081074+00	0	1	healthy
1178	2	2026-06-23 11:08:23.081074+00	0	1	healthy
1179	3	2026-06-23 11:08:23.081074+00	0	1	healthy
1180	4	2026-06-23 11:08:23.081074+00	0	1	healthy
1181	1	2026-06-23 11:09:23.07908+00	0	1	healthy
1182	5	2026-06-23 11:09:23.07908+00	0	1	healthy
1183	2	2026-06-23 11:09:23.07908+00	0	1	healthy
1184	3	2026-06-23 11:09:23.07908+00	0	1	healthy
1185	4	2026-06-23 11:09:23.07908+00	0	1	healthy
1186	1	2026-06-23 11:10:23.078933+00	0	1	healthy
1187	5	2026-06-23 11:10:23.078933+00	0	1	healthy
1188	2	2026-06-23 11:10:23.078933+00	0	1	healthy
1189	3	2026-06-23 11:10:23.078933+00	0	1	healthy
1190	4	2026-06-23 11:10:23.078933+00	0	1	healthy
1191	1	2026-06-23 11:11:23.086418+00	0	1	healthy
1192	5	2026-06-23 11:11:23.086418+00	0	1	healthy
1193	2	2026-06-23 11:11:23.086418+00	0	1	healthy
1194	3	2026-06-23 11:11:23.086418+00	0	1	healthy
1195	4	2026-06-23 11:11:23.086418+00	0	1	healthy
1196	1	2026-06-23 11:42:23.087119+00	0	1	healthy
1197	5	2026-06-23 11:42:23.087119+00	0	1	healthy
1198	2	2026-06-23 11:42:23.087119+00	0	1	healthy
1199	3	2026-06-23 11:42:23.087119+00	0	1	healthy
1200	4	2026-06-23 11:42:23.087119+00	0	1	healthy
1201	1	2026-06-23 11:43:23.079718+00	0	1	healthy
1202	5	2026-06-23 11:43:23.079718+00	0	1	healthy
1203	2	2026-06-23 11:43:23.079718+00	0	1	healthy
1204	3	2026-06-23 11:43:23.079718+00	0	1	healthy
1205	4	2026-06-23 11:43:23.079718+00	0	1	healthy
1206	1	2026-06-23 11:44:23.078957+00	0	1	healthy
1207	5	2026-06-23 11:44:23.078957+00	0	1	healthy
1208	2	2026-06-23 11:44:23.078957+00	0	1	healthy
1209	3	2026-06-23 11:44:23.078957+00	0	1	healthy
1210	4	2026-06-23 11:44:23.078957+00	0	1	healthy
1211	1	2026-06-23 11:45:23.079102+00	0	1	healthy
1212	5	2026-06-23 11:45:23.079102+00	0	1	healthy
1213	2	2026-06-23 11:45:23.079102+00	0	1	healthy
1214	3	2026-06-23 11:45:23.079102+00	0	1	healthy
1215	4	2026-06-23 11:45:23.079102+00	0	1	healthy
1216	1	2026-06-23 11:46:23.07857+00	0	1	healthy
1217	5	2026-06-23 11:46:23.07857+00	0	1	healthy
1218	2	2026-06-23 11:46:23.07857+00	0	1	healthy
1219	3	2026-06-23 11:46:23.07857+00	0	1	healthy
1220	4	2026-06-23 11:46:23.07857+00	0	1	healthy
1221	1	2026-06-23 12:04:23.080566+00	0	1	healthy
1222	5	2026-06-23 12:04:23.080566+00	0	1	healthy
1223	2	2026-06-23 12:04:23.080566+00	0	1	healthy
1224	3	2026-06-23 12:04:23.080566+00	0	1	healthy
1225	4	2026-06-23 12:04:23.080566+00	0	1	healthy
1226	1	2026-06-23 12:05:23.081325+00	0	1	healthy
1227	5	2026-06-23 12:05:23.081325+00	0	1	healthy
1228	2	2026-06-23 12:05:23.081325+00	0	1	healthy
1229	3	2026-06-23 12:05:23.081325+00	0	1	healthy
1230	4	2026-06-23 12:05:23.081325+00	0	1	healthy
1506	1	2026-06-23 20:14:23.093345+00	0	1	healthy
1507	5	2026-06-23 20:14:23.093345+00	0	1	healthy
1508	2	2026-06-23 20:14:23.093345+00	0	1	healthy
1509	3	2026-06-23 20:14:23.093345+00	0	1	healthy
1510	4	2026-06-23 20:14:23.093345+00	0	1	healthy
1531	1	2026-06-23 23:01:23.081827+00	0	1	healthy
1532	5	2026-06-23 23:01:23.081827+00	0	1	healthy
1533	2	2026-06-23 23:01:23.081827+00	0	1	healthy
1534	3	2026-06-23 23:01:23.081827+00	0	1	healthy
1535	4	2026-06-23 23:01:23.081827+00	0	1	healthy
1561	1	2026-06-24 01:42:23.080162+00	0	1	healthy
1562	5	2026-06-24 01:42:23.080162+00	0	1	healthy
1563	2	2026-06-24 01:42:23.080162+00	0	1	healthy
1564	3	2026-06-24 01:42:23.080162+00	0	1	healthy
1565	4	2026-06-24 01:42:23.080162+00	0	1	healthy
1581	1	2026-06-24 01:50:23.079629+00	0	1	healthy
1582	5	2026-06-24 01:50:23.079629+00	0	1	healthy
1583	2	2026-06-24 01:50:23.079629+00	0	1	healthy
1584	3	2026-06-24 01:50:23.079629+00	0	1	healthy
1585	4	2026-06-24 01:50:23.079629+00	0	1	healthy
1596	1	2026-06-24 01:53:23.080325+00	0	1	healthy
1597	5	2026-06-24 01:53:23.080325+00	0	1	healthy
1598	2	2026-06-24 01:53:23.080325+00	0	1	healthy
1599	3	2026-06-24 01:53:23.080325+00	0	1	healthy
1600	4	2026-06-24 01:53:23.080325+00	0	1	healthy
1731	1	2026-06-24 02:20:23.079504+00	0	1	healthy
1732	5	2026-06-24 02:20:23.079504+00	0	1	healthy
1733	2	2026-06-24 02:20:23.079504+00	0	1	healthy
1734	3	2026-06-24 02:20:23.079504+00	0	1	healthy
1735	4	2026-06-24 02:20:23.079504+00	0	1	healthy
2281	1	2026-06-24 04:14:16.70526+00	0	1	healthy
2282	5	2026-06-24 04:14:16.70526+00	0	1	healthy
2283	2	2026-06-24 04:14:16.70526+00	0	1	healthy
2284	3	2026-06-24 04:14:16.70526+00	0	1	healthy
2285	4	2026-06-24 04:14:16.70526+00	0	1	healthy
2286	1	2026-06-24 04:15:16.706595+00	0	1	healthy
2287	5	2026-06-24 04:15:16.706595+00	0	1	healthy
2288	2	2026-06-24 04:15:16.706595+00	0	1	healthy
2289	3	2026-06-24 04:15:16.706595+00	0	1	healthy
2290	4	2026-06-24 04:15:16.706595+00	0	1	healthy
2291	1	2026-06-24 04:16:16.709088+00	0	1	healthy
2292	5	2026-06-24 04:16:16.709088+00	0	1	healthy
2293	2	2026-06-24 04:16:16.709088+00	0	1	healthy
2294	3	2026-06-24 04:16:16.709088+00	0	1	healthy
2295	4	2026-06-24 04:16:16.709088+00	0	1	healthy
2296	1	2026-06-24 04:17:16.706186+00	0	1	healthy
2297	5	2026-06-24 04:17:16.706186+00	0	1	healthy
2298	2	2026-06-24 04:17:16.706186+00	0	1	healthy
2299	3	2026-06-24 04:17:16.706186+00	0	1	healthy
2300	4	2026-06-24 04:17:16.706186+00	0	1	healthy
2301	1	2026-06-24 04:18:16.706219+00	0	1	healthy
2302	5	2026-06-24 04:18:16.706219+00	0	1	healthy
2303	2	2026-06-24 04:18:16.706219+00	0	1	healthy
2304	3	2026-06-24 04:18:16.706219+00	0	1	healthy
2305	4	2026-06-24 04:18:16.706219+00	0	1	healthy
2306	1	2026-06-24 04:19:16.705128+00	0	1	healthy
2307	5	2026-06-24 04:19:16.705128+00	0	1	healthy
2308	2	2026-06-24 04:19:16.705128+00	0	1	healthy
2309	3	2026-06-24 04:19:16.705128+00	0	1	healthy
2310	4	2026-06-24 04:19:16.705128+00	0	1	healthy
2311	1	2026-06-24 04:20:16.706299+00	0	1	healthy
2312	5	2026-06-24 04:20:16.706299+00	0	1	healthy
2313	2	2026-06-24 04:20:16.706299+00	0	1	healthy
2314	3	2026-06-24 04:20:16.706299+00	0	1	healthy
2315	4	2026-06-24 04:20:16.706299+00	0	1	healthy
2316	1	2026-06-24 04:21:16.774642+00	0	1	healthy
2317	5	2026-06-24 04:21:16.774642+00	0	1	healthy
2318	2	2026-06-24 04:21:16.774642+00	0	1	healthy
2319	3	2026-06-24 04:21:16.774642+00	0	1	healthy
2320	4	2026-06-24 04:21:16.774642+00	0	1	healthy
2321	1	2026-06-24 04:22:16.706067+00	0	1	healthy
2322	5	2026-06-24 04:22:16.706067+00	0	1	healthy
2323	2	2026-06-24 04:22:16.706067+00	0	1	healthy
2324	3	2026-06-24 04:22:16.706067+00	0	1	healthy
2325	4	2026-06-24 04:22:16.706067+00	0	1	healthy
2326	1	2026-06-24 04:23:16.706417+00	0	1	healthy
2327	5	2026-06-24 04:23:16.706417+00	0	1	healthy
2328	2	2026-06-24 04:23:16.706417+00	0	1	healthy
2329	3	2026-06-24 04:23:16.706417+00	0	1	healthy
2330	4	2026-06-24 04:23:16.706417+00	0	1	healthy
2331	1	2026-06-24 04:24:16.705718+00	0	1	healthy
2332	5	2026-06-24 04:24:16.705718+00	0	1	healthy
2333	2	2026-06-24 04:24:16.705718+00	0	1	healthy
2334	3	2026-06-24 04:24:16.705718+00	0	1	healthy
2335	4	2026-06-24 04:24:16.705718+00	0	1	healthy
2336	1	2026-06-24 04:25:16.705705+00	0	1	healthy
2337	5	2026-06-24 04:25:16.705705+00	0	1	healthy
2338	2	2026-06-24 04:25:16.705705+00	0	1	healthy
2339	3	2026-06-24 04:25:16.705705+00	0	1	healthy
2340	4	2026-06-24 04:25:16.705705+00	0	1	healthy
2341	1	2026-06-24 04:26:16.706361+00	0	1	healthy
2342	5	2026-06-24 04:26:16.706361+00	0	1	healthy
2343	2	2026-06-24 04:26:16.706361+00	0	1	healthy
2344	3	2026-06-24 04:26:16.706361+00	0	1	healthy
2345	4	2026-06-24 04:26:16.706361+00	0	1	healthy
2346	1	2026-06-24 04:27:16.706875+00	0	1	healthy
2347	5	2026-06-24 04:27:16.706875+00	0	1	healthy
2348	2	2026-06-24 04:27:16.706875+00	0	1	healthy
2349	3	2026-06-24 04:27:16.706875+00	0	1	healthy
2350	4	2026-06-24 04:27:16.706875+00	0	1	healthy
2351	1	2026-06-24 04:28:16.705982+00	0	1	healthy
2352	5	2026-06-24 04:28:16.705982+00	0	1	healthy
2353	2	2026-06-24 04:28:16.705982+00	0	1	healthy
2354	3	2026-06-24 04:28:16.705982+00	0	1	healthy
2355	4	2026-06-24 04:28:16.705982+00	0	1	healthy
2356	1	2026-06-24 04:29:16.705696+00	0	1	healthy
2357	5	2026-06-24 04:29:16.705696+00	0	1	healthy
2358	2	2026-06-24 04:29:16.705696+00	0	1	healthy
2359	3	2026-06-24 04:29:16.705696+00	0	1	healthy
2360	4	2026-06-24 04:29:16.705696+00	0	1	healthy
2361	1	2026-06-24 04:30:16.70608+00	0	1	healthy
2362	5	2026-06-24 04:30:16.70608+00	0	1	healthy
2363	2	2026-06-24 04:30:16.70608+00	0	1	healthy
2364	3	2026-06-24 04:30:16.70608+00	0	1	healthy
2365	4	2026-06-24 04:30:16.70608+00	0	1	healthy
2366	1	2026-06-24 04:31:16.706822+00	0	1	healthy
2367	5	2026-06-24 04:31:16.706822+00	0	1	healthy
2368	2	2026-06-24 04:31:16.706822+00	0	1	healthy
2369	3	2026-06-24 04:31:16.706822+00	0	1	healthy
2370	4	2026-06-24 04:31:16.706822+00	0	1	healthy
2371	1	2026-06-24 04:32:16.706305+00	0	1	healthy
2372	5	2026-06-24 04:32:16.706305+00	0	1	healthy
2373	2	2026-06-24 04:32:16.706305+00	0	1	healthy
2374	3	2026-06-24 04:32:16.706305+00	0	1	healthy
2375	4	2026-06-24 04:32:16.706305+00	0	1	healthy
2376	1	2026-06-24 04:33:16.70736+00	0	1	healthy
2377	5	2026-06-24 04:33:16.70736+00	0	1	healthy
2378	2	2026-06-24 04:33:16.70736+00	0	1	healthy
2379	3	2026-06-24 04:33:16.70736+00	0	1	healthy
2380	4	2026-06-24 04:33:16.70736+00	0	1	healthy
2381	1	2026-06-24 04:34:16.706266+00	0	1	healthy
2382	5	2026-06-24 04:34:16.706266+00	0	1	healthy
2383	2	2026-06-24 04:34:16.706266+00	0	1	healthy
2384	3	2026-06-24 04:34:16.706266+00	0	1	healthy
2385	4	2026-06-24 04:34:16.706266+00	0	1	healthy
2386	1	2026-06-24 04:35:16.705655+00	0	1	healthy
2387	5	2026-06-24 04:35:16.705655+00	0	1	healthy
2388	2	2026-06-24 04:35:16.705655+00	0	1	healthy
2389	3	2026-06-24 04:35:16.705655+00	0	1	healthy
2390	4	2026-06-24 04:35:16.705655+00	0	1	healthy
2391	1	2026-06-24 04:36:16.70642+00	0	1	healthy
2392	5	2026-06-24 04:36:16.70642+00	0	1	healthy
2393	2	2026-06-24 04:36:16.70642+00	0	1	healthy
2394	3	2026-06-24 04:36:16.70642+00	0	1	healthy
2395	4	2026-06-24 04:36:16.70642+00	0	1	healthy
2396	1	2026-06-24 04:37:16.751702+00	0	1	healthy
2397	5	2026-06-24 04:37:16.751702+00	0	1	healthy
2398	2	2026-06-24 04:37:16.751702+00	0	1	healthy
2399	3	2026-06-24 04:37:16.751702+00	0	1	healthy
2400	4	2026-06-24 04:37:16.751702+00	0	1	healthy
2401	1	2026-06-24 04:38:16.706222+00	0	1	healthy
2402	5	2026-06-24 04:38:16.706222+00	0	1	healthy
2403	2	2026-06-24 04:38:16.706222+00	0	1	healthy
2404	3	2026-06-24 04:38:16.706222+00	0	1	healthy
2405	4	2026-06-24 04:38:16.706222+00	0	1	healthy
2421	1	2026-06-24 04:42:16.70624+00	0	1	healthy
2422	5	2026-06-24 04:42:16.70624+00	0	1	healthy
2423	2	2026-06-24 04:42:16.70624+00	0	1	healthy
2424	3	2026-06-24 04:42:16.70624+00	0	1	healthy
2425	4	2026-06-24 04:42:16.70624+00	0	1	healthy
2726	1	2026-06-24 06:29:14.211334+00	0	1	healthy
2727	5	2026-06-24 06:29:14.211334+00	0	1	healthy
2728	2	2026-06-24 06:29:14.211334+00	0	1	healthy
2729	3	2026-06-24 06:29:14.211334+00	0	1	healthy
2730	4	2026-06-24 06:29:14.211334+00	0	1	healthy
2741	1	2026-06-24 06:32:14.203016+00	0	1	healthy
2742	5	2026-06-24 06:32:14.203016+00	0	1	healthy
2743	2	2026-06-24 06:32:14.203016+00	0	1	healthy
2744	3	2026-06-24 06:32:14.203016+00	0	1	healthy
2745	4	2026-06-24 06:32:14.203016+00	0	1	healthy
2751	1	2026-06-24 06:34:14.204081+00	0	1	healthy
2752	5	2026-06-24 06:34:14.204081+00	0	1	healthy
2753	2	2026-06-24 06:34:14.204081+00	0	1	healthy
2754	3	2026-06-24 06:34:14.204081+00	0	1	healthy
2755	4	2026-06-24 06:34:14.204081+00	0	1	healthy
2761	1	2026-06-24 06:36:14.203799+00	0	1	healthy
2762	5	2026-06-24 06:36:14.203799+00	0	1	healthy
2763	2	2026-06-24 06:36:14.203799+00	0	1	healthy
2764	3	2026-06-24 06:36:14.203799+00	0	1	healthy
2765	4	2026-06-24 06:36:14.203799+00	0	1	healthy
2786	1	2026-06-24 06:41:14.202881+00	0	1	healthy
2787	5	2026-06-24 06:41:14.202881+00	0	1	healthy
2788	2	2026-06-24 06:41:14.202881+00	0	1	healthy
2789	3	2026-06-24 06:41:14.202881+00	0	1	healthy
2790	4	2026-06-24 06:41:14.202881+00	0	1	healthy
2816	1	2026-06-24 06:47:14.204391+00	0	1	healthy
2817	5	2026-06-24 06:47:14.204391+00	0	1	healthy
2818	2	2026-06-24 06:47:14.204391+00	0	1	healthy
2819	3	2026-06-24 06:47:14.204391+00	0	1	healthy
2820	4	2026-06-24 06:47:14.204391+00	0	1	healthy
2871	1	2026-06-24 06:58:39.24342+00	0	1	healthy
2872	5	2026-06-24 06:58:39.24342+00	0	1	healthy
2873	2	2026-06-24 06:58:39.24342+00	0	1	healthy
2874	3	2026-06-24 06:58:39.24342+00	0	1	healthy
2875	4	2026-06-24 06:58:39.24342+00	0	1	healthy
3116	1	2026-06-24 07:47:39.190885+00	0	1	healthy
3117	5	2026-06-24 07:47:39.190885+00	0	1	healthy
3118	2	2026-06-24 07:47:39.190885+00	0	1	healthy
3119	3	2026-06-24 07:47:39.190885+00	0	1	healthy
3120	4	2026-06-24 07:47:39.190885+00	0	1	healthy
3126	1	2026-06-24 07:49:39.180833+00	0	1	healthy
3127	5	2026-06-24 07:49:39.180833+00	0	1	healthy
3128	2	2026-06-24 07:49:39.180833+00	0	1	healthy
3129	3	2026-06-24 07:49:39.180833+00	0	1	healthy
3130	4	2026-06-24 07:49:39.180833+00	0	1	healthy
3151	1	2026-06-24 07:54:39.182489+00	0	1	healthy
3152	5	2026-06-24 07:54:39.182489+00	0	1	healthy
3153	2	2026-06-24 07:54:39.182489+00	0	1	healthy
3154	3	2026-06-24 07:54:39.182489+00	0	1	healthy
3155	4	2026-06-24 07:54:39.182489+00	0	1	healthy
3176	1	2026-06-24 07:59:39.210911+00	0	1	healthy
3177	5	2026-06-24 07:59:39.210911+00	0	1	healthy
3178	2	2026-06-24 07:59:39.210911+00	0	1	healthy
3179	3	2026-06-24 07:59:39.210911+00	0	1	healthy
3180	4	2026-06-24 07:59:39.210911+00	0	1	healthy
3201	1	2026-06-24 08:04:39.18074+00	0	1	healthy
3202	5	2026-06-24 08:04:39.18074+00	0	1	healthy
3203	2	2026-06-24 08:04:39.18074+00	0	1	healthy
3204	3	2026-06-24 08:04:39.18074+00	0	1	healthy
3205	4	2026-06-24 08:04:39.18074+00	0	1	healthy
3211	1	2026-06-24 08:06:39.180694+00	0	1	healthy
3212	5	2026-06-24 08:06:39.180694+00	0	1	healthy
3213	2	2026-06-24 08:06:39.180694+00	0	1	healthy
3214	3	2026-06-24 08:06:39.180694+00	0	1	healthy
3215	4	2026-06-24 08:06:39.180694+00	0	1	healthy
3221	1	2026-06-24 08:08:39.179335+00	0	1	healthy
3222	5	2026-06-24 08:08:39.179335+00	0	1	healthy
3223	2	2026-06-24 08:08:39.179335+00	0	1	healthy
3224	3	2026-06-24 08:08:39.179335+00	0	1	healthy
3225	4	2026-06-24 08:08:39.179335+00	0	1	healthy
3256	1	2026-06-24 08:15:39.180843+00	0	1	healthy
3257	5	2026-06-24 08:15:39.180843+00	0	1	healthy
3258	2	2026-06-24 08:15:39.180843+00	0	1	healthy
3259	3	2026-06-24 08:15:39.180843+00	0	1	healthy
3260	4	2026-06-24 08:15:39.180843+00	0	1	healthy
3281	1	2026-06-24 08:20:39.179502+00	0	1	healthy
3282	5	2026-06-24 08:20:39.179502+00	0	1	healthy
3283	2	2026-06-24 08:20:39.179502+00	0	1	healthy
3284	3	2026-06-24 08:20:39.179502+00	0	1	healthy
3285	4	2026-06-24 08:20:39.179502+00	0	1	healthy
3296	1	2026-06-24 08:23:39.180019+00	0	1	healthy
3297	5	2026-06-24 08:23:39.180019+00	0	1	healthy
3298	2	2026-06-24 08:23:39.180019+00	0	1	healthy
3299	3	2026-06-24 08:23:39.180019+00	0	1	healthy
3300	4	2026-06-24 08:23:39.180019+00	0	1	healthy
3316	1	2026-06-24 08:27:39.194492+00	0	1	healthy
3317	5	2026-06-24 08:27:39.194492+00	0	1	healthy
3318	2	2026-06-24 08:27:39.194492+00	0	1	healthy
3319	3	2026-06-24 08:27:39.194492+00	0	1	healthy
3320	4	2026-06-24 08:27:39.194492+00	0	1	healthy
3321	1	2026-06-24 08:28:39.194394+00	0	1	healthy
3322	5	2026-06-24 08:28:39.194394+00	0	1	healthy
3323	2	2026-06-24 08:28:39.194394+00	0	1	healthy
3324	3	2026-06-24 08:28:39.194394+00	0	1	healthy
3325	4	2026-06-24 08:28:39.194394+00	0	1	healthy
3326	1	2026-06-24 08:29:39.204332+00	0	1	healthy
3327	5	2026-06-24 08:29:39.204332+00	0	1	healthy
3328	2	2026-06-24 08:29:39.204332+00	0	1	healthy
3329	3	2026-06-24 08:29:39.204332+00	0	1	healthy
3330	4	2026-06-24 08:29:39.204332+00	0	1	healthy
3341	1	2026-06-24 08:32:39.182464+00	0	1	healthy
3342	5	2026-06-24 08:32:39.182464+00	0	1	healthy
3343	2	2026-06-24 08:32:39.182464+00	0	1	healthy
3344	3	2026-06-24 08:32:39.182464+00	0	1	healthy
3345	4	2026-06-24 08:32:39.182464+00	0	1	healthy
3356	1	2026-06-24 08:35:39.180319+00	0	1	healthy
3357	5	2026-06-24 08:35:39.180319+00	0	1	healthy
3358	2	2026-06-24 08:35:39.180319+00	0	1	healthy
3359	3	2026-06-24 08:35:39.180319+00	0	1	healthy
3360	4	2026-06-24 08:35:39.180319+00	0	1	healthy
2406	1	2026-06-24 04:39:16.705989+00	0	1	healthy
2407	5	2026-06-24 04:39:16.705989+00	0	1	healthy
2408	2	2026-06-24 04:39:16.705989+00	0	1	healthy
2409	3	2026-06-24 04:39:16.705989+00	0	1	healthy
2410	4	2026-06-24 04:39:16.705989+00	0	1	healthy
2416	1	2026-06-24 04:41:16.708708+00	0	1	healthy
2417	5	2026-06-24 04:41:16.708708+00	0	1	healthy
2418	2	2026-06-24 04:41:16.708708+00	0	1	healthy
2419	3	2026-06-24 04:41:16.708708+00	0	1	healthy
2420	4	2026-06-24 04:41:16.708708+00	0	1	healthy
2431	1	2026-06-24 04:44:16.705485+00	0	1	healthy
2432	5	2026-06-24 04:44:16.705485+00	0	1	healthy
2433	2	2026-06-24 04:44:16.705485+00	0	1	healthy
2434	3	2026-06-24 04:44:16.705485+00	0	1	healthy
2435	4	2026-06-24 04:44:16.705485+00	0	1	healthy
2436	1	2026-06-24 04:45:16.705567+00	0	1	healthy
2437	5	2026-06-24 04:45:16.705567+00	0	1	healthy
2438	2	2026-06-24 04:45:16.705567+00	0	1	healthy
2439	3	2026-06-24 04:45:16.705567+00	0	1	healthy
2440	4	2026-06-24 04:45:16.705567+00	0	1	healthy
2731	1	2026-06-24 06:30:14.204088+00	0	1	healthy
2732	5	2026-06-24 06:30:14.204088+00	0	1	healthy
2733	2	2026-06-24 06:30:14.204088+00	0	1	healthy
2734	3	2026-06-24 06:30:14.204088+00	0	1	healthy
2735	4	2026-06-24 06:30:14.204088+00	0	1	healthy
2791	1	2026-06-24 06:42:14.20275+00	0	1	healthy
2792	5	2026-06-24 06:42:14.20275+00	0	1	healthy
2793	2	2026-06-24 06:42:14.20275+00	0	1	healthy
2794	3	2026-06-24 06:42:14.20275+00	0	1	healthy
2795	4	2026-06-24 06:42:14.20275+00	0	1	healthy
2891	1	2026-06-24 07:02:39.180222+00	0	1	healthy
2892	5	2026-06-24 07:02:39.180222+00	0	1	healthy
2893	2	2026-06-24 07:02:39.180222+00	0	1	healthy
2894	3	2026-06-24 07:02:39.180222+00	0	1	healthy
2895	4	2026-06-24 07:02:39.180222+00	0	1	healthy
2941	1	2026-06-24 07:12:39.180974+00	0	1	healthy
2942	5	2026-06-24 07:12:39.180974+00	0	1	healthy
2943	2	2026-06-24 07:12:39.180974+00	0	1	healthy
2944	3	2026-06-24 07:12:39.180974+00	0	1	healthy
2945	4	2026-06-24 07:12:39.180974+00	0	1	healthy
2951	1	2026-06-24 07:14:39.180441+00	0	1	healthy
2952	5	2026-06-24 07:14:39.180441+00	0	1	healthy
2953	2	2026-06-24 07:14:39.180441+00	0	1	healthy
2954	3	2026-06-24 07:14:39.180441+00	0	1	healthy
2955	4	2026-06-24 07:14:39.180441+00	0	1	healthy
2966	1	2026-06-24 07:17:39.183522+00	0	1	healthy
2967	5	2026-06-24 07:17:39.183522+00	0	1	healthy
2968	2	2026-06-24 07:17:39.183522+00	0	1	healthy
2969	3	2026-06-24 07:17:39.183522+00	0	1	healthy
2970	4	2026-06-24 07:17:39.183522+00	0	1	healthy
2976	1	2026-06-24 07:19:39.179493+00	0	1	healthy
2977	5	2026-06-24 07:19:39.179493+00	0	1	healthy
2978	2	2026-06-24 07:19:39.179493+00	0	1	healthy
2979	3	2026-06-24 07:19:39.179493+00	0	1	healthy
2980	4	2026-06-24 07:19:39.179493+00	0	1	healthy
2991	1	2026-06-24 07:22:39.180451+00	0	1	healthy
2992	5	2026-06-24 07:22:39.180451+00	0	1	healthy
2993	2	2026-06-24 07:22:39.180451+00	0	1	healthy
2994	3	2026-06-24 07:22:39.180451+00	0	1	healthy
2995	4	2026-06-24 07:22:39.180451+00	0	1	healthy
3021	1	2026-06-24 07:28:39.179137+00	0	1	healthy
3022	5	2026-06-24 07:28:39.179137+00	0	1	healthy
3023	2	2026-06-24 07:28:39.179137+00	0	1	healthy
3024	3	2026-06-24 07:28:39.179137+00	0	1	healthy
3025	4	2026-06-24 07:28:39.179137+00	0	1	healthy
3061	1	2026-06-24 07:36:39.183969+00	0	1	healthy
3062	5	2026-06-24 07:36:39.183969+00	0	1	healthy
3063	2	2026-06-24 07:36:39.183969+00	0	1	healthy
3064	3	2026-06-24 07:36:39.183969+00	0	1	healthy
3065	4	2026-06-24 07:36:39.183969+00	0	1	healthy
3101	1	2026-06-24 07:44:39.233585+00	0	1	healthy
3102	5	2026-06-24 07:44:39.233585+00	0	1	healthy
3103	2	2026-06-24 07:44:39.233585+00	0	1	healthy
3104	3	2026-06-24 07:44:39.233585+00	0	1	healthy
3105	4	2026-06-24 07:44:39.233585+00	0	1	healthy
3121	1	2026-06-24 07:48:39.18115+00	0	1	healthy
3122	5	2026-06-24 07:48:39.18115+00	0	1	healthy
3123	2	2026-06-24 07:48:39.18115+00	0	1	healthy
3124	3	2026-06-24 07:48:39.18115+00	0	1	healthy
3125	4	2026-06-24 07:48:39.18115+00	0	1	healthy
3171	1	2026-06-24 07:58:39.180006+00	0	1	healthy
3172	5	2026-06-24 07:58:39.180006+00	0	1	healthy
3173	2	2026-06-24 07:58:39.180006+00	0	1	healthy
3174	3	2026-06-24 07:58:39.180006+00	0	1	healthy
3175	4	2026-06-24 07:58:39.180006+00	0	1	healthy
3226	1	2026-06-24 08:09:39.180133+00	0	1	healthy
3227	5	2026-06-24 08:09:39.180133+00	0	1	healthy
3228	2	2026-06-24 08:09:39.180133+00	0	1	healthy
3229	3	2026-06-24 08:09:39.180133+00	0	1	healthy
3230	4	2026-06-24 08:09:39.180133+00	0	1	healthy
3276	1	2026-06-24 08:19:39.180793+00	0	1	healthy
3277	5	2026-06-24 08:19:39.180793+00	0	1	healthy
3278	2	2026-06-24 08:19:39.180793+00	0	1	healthy
3279	3	2026-06-24 08:19:39.180793+00	0	1	healthy
3280	4	2026-06-24 08:19:39.180793+00	0	1	healthy
3331	1	2026-06-24 08:30:39.197831+00	0	1	healthy
3332	5	2026-06-24 08:30:39.197831+00	0	1	healthy
3333	2	2026-06-24 08:30:39.197831+00	0	1	healthy
3334	3	2026-06-24 08:30:39.197831+00	0	1	healthy
3335	4	2026-06-24 08:30:39.197831+00	0	1	healthy
3346	1	2026-06-24 08:33:39.179732+00	0	1	healthy
3347	5	2026-06-24 08:33:39.179732+00	0	1	healthy
3348	2	2026-06-24 08:33:39.179732+00	0	1	healthy
3349	3	2026-06-24 08:33:39.179732+00	0	1	healthy
3350	4	2026-06-24 08:33:39.179732+00	0	1	healthy
3361	1	2026-06-24 08:36:39.179147+00	0	1	healthy
3362	5	2026-06-24 08:36:39.179147+00	0	1	healthy
3363	2	2026-06-24 08:36:39.179147+00	0	1	healthy
3364	3	2026-06-24 08:36:39.179147+00	0	1	healthy
3365	4	2026-06-24 08:36:39.179147+00	0	1	healthy
3401	1	2026-06-24 08:44:39.179981+00	0	1	healthy
3402	5	2026-06-24 08:44:39.179981+00	0	1	healthy
3403	2	2026-06-24 08:44:39.179981+00	0	1	healthy
3404	3	2026-06-24 08:44:39.179981+00	0	1	healthy
3405	4	2026-06-24 08:44:39.179981+00	0	1	healthy
3416	1	2026-06-24 08:47:39.179949+00	0	1	healthy
3417	5	2026-06-24 08:47:39.179949+00	0	1	healthy
3418	2	2026-06-24 08:47:39.179949+00	0	1	healthy
3419	3	2026-06-24 08:47:39.179949+00	0	1	healthy
3420	4	2026-06-24 08:47:39.179949+00	0	1	healthy
2411	1	2026-06-24 04:40:16.705537+00	0	1	healthy
2412	5	2026-06-24 04:40:16.705537+00	0	1	healthy
2413	2	2026-06-24 04:40:16.705537+00	0	1	healthy
2414	3	2026-06-24 04:40:16.705537+00	0	1	healthy
2415	4	2026-06-24 04:40:16.705537+00	0	1	healthy
2441	1	2026-06-24 04:46:16.707734+00	0	1	healthy
2442	5	2026-06-24 04:46:16.707734+00	0	1	healthy
2443	2	2026-06-24 04:46:16.707734+00	0	1	healthy
2444	3	2026-06-24 04:46:16.707734+00	0	1	healthy
2445	4	2026-06-24 04:46:16.707734+00	0	1	healthy
2736	1	2026-06-24 06:31:14.202947+00	0	1	healthy
2737	5	2026-06-24 06:31:14.202947+00	0	1	healthy
2738	2	2026-06-24 06:31:14.202947+00	0	1	healthy
2739	3	2026-06-24 06:31:14.202947+00	0	1	healthy
2740	4	2026-06-24 06:31:14.202947+00	0	1	healthy
2796	1	2026-06-24 06:43:14.203946+00	0	1	healthy
2797	5	2026-06-24 06:43:14.203946+00	0	1	healthy
2798	2	2026-06-24 06:43:14.203946+00	0	1	healthy
2799	3	2026-06-24 06:43:14.203946+00	0	1	healthy
2800	4	2026-06-24 06:43:14.203946+00	0	1	healthy
2901	1	2026-06-24 07:04:39.180985+00	0	1	healthy
2902	5	2026-06-24 07:04:39.180985+00	0	1	healthy
2903	2	2026-06-24 07:04:39.180985+00	0	1	healthy
2904	3	2026-06-24 07:04:39.180985+00	0	1	healthy
2905	4	2026-06-24 07:04:39.180985+00	0	1	healthy
2911	1	2026-06-24 07:06:39.178944+00	0	1	healthy
2912	5	2026-06-24 07:06:39.178944+00	0	1	healthy
2913	2	2026-06-24 07:06:39.178944+00	0	1	healthy
2914	3	2026-06-24 07:06:39.178944+00	0	1	healthy
2915	4	2026-06-24 07:06:39.178944+00	0	1	healthy
2936	1	2026-06-24 07:11:39.180564+00	0	1	healthy
2937	5	2026-06-24 07:11:39.180564+00	0	1	healthy
2938	2	2026-06-24 07:11:39.180564+00	0	1	healthy
2939	3	2026-06-24 07:11:39.180564+00	0	1	healthy
2940	4	2026-06-24 07:11:39.180564+00	0	1	healthy
2946	1	2026-06-24 07:13:39.179031+00	0	1	healthy
2947	5	2026-06-24 07:13:39.179031+00	0	1	healthy
2948	2	2026-06-24 07:13:39.179031+00	0	1	healthy
2949	3	2026-06-24 07:13:39.179031+00	0	1	healthy
2950	4	2026-06-24 07:13:39.179031+00	0	1	healthy
3006	1	2026-06-24 07:25:39.180681+00	0	1	healthy
3007	5	2026-06-24 07:25:39.180681+00	0	1	healthy
3008	2	2026-06-24 07:25:39.180681+00	0	1	healthy
3009	3	2026-06-24 07:25:39.180681+00	0	1	healthy
3010	4	2026-06-24 07:25:39.180681+00	0	1	healthy
3011	1	2026-06-24 07:26:39.182428+00	0	1	healthy
3012	5	2026-06-24 07:26:39.182428+00	0	1	healthy
3013	2	2026-06-24 07:26:39.182428+00	0	1	healthy
3014	3	2026-06-24 07:26:39.182428+00	0	1	healthy
3015	4	2026-06-24 07:26:39.182428+00	0	1	healthy
3016	1	2026-06-24 07:27:39.185172+00	0	1	healthy
3017	5	2026-06-24 07:27:39.185172+00	0	1	healthy
3018	2	2026-06-24 07:27:39.185172+00	0	1	healthy
3019	3	2026-06-24 07:27:39.185172+00	0	1	healthy
3020	4	2026-06-24 07:27:39.185172+00	0	1	healthy
3046	1	2026-06-24 07:33:39.180191+00	0	1	healthy
3047	5	2026-06-24 07:33:39.180191+00	0	1	healthy
3048	2	2026-06-24 07:33:39.180191+00	0	1	healthy
3049	3	2026-06-24 07:33:39.180191+00	0	1	healthy
3050	4	2026-06-24 07:33:39.180191+00	0	1	healthy
3056	1	2026-06-24 07:35:39.183015+00	0	1	healthy
3057	5	2026-06-24 07:35:39.183015+00	0	1	healthy
3058	2	2026-06-24 07:35:39.183015+00	0	1	healthy
3059	3	2026-06-24 07:35:39.183015+00	0	1	healthy
3060	4	2026-06-24 07:35:39.183015+00	0	1	healthy
3076	1	2026-06-24 07:39:39.1798+00	0	1	healthy
3077	5	2026-06-24 07:39:39.1798+00	0	1	healthy
3078	2	2026-06-24 07:39:39.1798+00	0	1	healthy
3079	3	2026-06-24 07:39:39.1798+00	0	1	healthy
3080	4	2026-06-24 07:39:39.1798+00	0	1	healthy
3091	1	2026-06-24 07:42:39.183003+00	0	1	healthy
3092	5	2026-06-24 07:42:39.183003+00	0	1	healthy
3093	2	2026-06-24 07:42:39.183003+00	0	1	healthy
3094	3	2026-06-24 07:42:39.183003+00	0	1	healthy
3095	4	2026-06-24 07:42:39.183003+00	0	1	healthy
3136	1	2026-06-24 07:51:39.197202+00	0	1	healthy
3137	5	2026-06-24 07:51:39.197202+00	0	1	healthy
3138	2	2026-06-24 07:51:39.197202+00	0	1	healthy
3139	3	2026-06-24 07:51:39.197202+00	0	1	healthy
3140	4	2026-06-24 07:51:39.197202+00	0	1	healthy
3166	1	2026-06-24 07:57:39.184524+00	0	1	healthy
3167	5	2026-06-24 07:57:39.184524+00	0	1	healthy
3168	2	2026-06-24 07:57:39.184524+00	0	1	healthy
3169	3	2026-06-24 07:57:39.184524+00	0	1	healthy
3170	4	2026-06-24 07:57:39.184524+00	0	1	healthy
3366	1	2026-06-24 08:37:39.181835+00	0	1	healthy
3367	5	2026-06-24 08:37:39.181835+00	0	1	healthy
3368	2	2026-06-24 08:37:39.181835+00	0	1	healthy
3369	3	2026-06-24 08:37:39.181835+00	0	1	healthy
3370	4	2026-06-24 08:37:39.181835+00	0	1	healthy
3376	1	2026-06-24 08:39:39.179996+00	0	1	healthy
3377	5	2026-06-24 08:39:39.179996+00	0	1	healthy
3378	2	2026-06-24 08:39:39.179996+00	0	1	healthy
3379	3	2026-06-24 08:39:39.179996+00	0	1	healthy
3380	4	2026-06-24 08:39:39.179996+00	0	1	healthy
3406	1	2026-06-24 08:45:39.227757+00	0	1	healthy
3407	5	2026-06-24 08:45:39.227757+00	0	1	healthy
3408	2	2026-06-24 08:45:39.227757+00	0	1	healthy
3409	3	2026-06-24 08:45:39.227757+00	0	1	healthy
3410	4	2026-06-24 08:45:39.227757+00	0	1	healthy
3421	1	2026-06-24 08:48:39.179084+00	0	1	healthy
3422	5	2026-06-24 08:48:39.179084+00	0	1	healthy
3423	2	2026-06-24 08:48:39.179084+00	0	1	healthy
3424	3	2026-06-24 08:48:39.179084+00	0	1	healthy
3425	4	2026-06-24 08:48:39.179084+00	0	1	healthy
3426	1	2026-06-24 08:49:39.179418+00	0	1	healthy
3427	5	2026-06-24 08:49:39.179418+00	0	1	healthy
3428	2	2026-06-24 08:49:39.179418+00	0	1	healthy
3429	3	2026-06-24 08:49:39.179418+00	0	1	healthy
3430	4	2026-06-24 08:49:39.179418+00	0	1	healthy
3446	1	2026-06-24 08:53:39.179396+00	0	1	healthy
3447	5	2026-06-24 08:53:39.179396+00	0	1	healthy
3448	2	2026-06-24 08:53:39.179396+00	0	1	healthy
3449	3	2026-06-24 08:53:39.179396+00	0	1	healthy
3450	4	2026-06-24 08:53:39.179396+00	0	1	healthy
3451	1	2026-06-24 08:54:39.181268+00	0	1	healthy
3452	5	2026-06-24 08:54:39.181268+00	0	1	healthy
3453	2	2026-06-24 08:54:39.181268+00	0	1	healthy
3454	3	2026-06-24 08:54:39.181268+00	0	1	healthy
3455	4	2026-06-24 08:54:39.181268+00	0	1	healthy
2426	1	2026-06-24 04:43:16.705725+00	0	1	healthy
2427	5	2026-06-24 04:43:16.705725+00	0	1	healthy
2428	2	2026-06-24 04:43:16.705725+00	0	1	healthy
2429	3	2026-06-24 04:43:16.705725+00	0	1	healthy
2430	4	2026-06-24 04:43:16.705725+00	0	1	healthy
2446	1	2026-06-24 04:47:16.706578+00	0	1	healthy
2447	5	2026-06-24 04:47:16.706578+00	0	1	healthy
2448	2	2026-06-24 04:47:16.706578+00	0	1	healthy
2449	3	2026-06-24 04:47:16.706578+00	0	1	healthy
2450	4	2026-06-24 04:47:16.706578+00	0	1	healthy
2451	1	2026-06-24 04:48:16.705344+00	0	1	healthy
2452	5	2026-06-24 04:48:16.705344+00	0	1	healthy
2453	2	2026-06-24 04:48:16.705344+00	0	1	healthy
2454	3	2026-06-24 04:48:16.705344+00	0	1	healthy
2455	4	2026-06-24 04:48:16.705344+00	0	1	healthy
2456	1	2026-06-24 04:49:16.705212+00	0	1	healthy
2457	5	2026-06-24 04:49:16.705212+00	0	1	healthy
2458	2	2026-06-24 04:49:16.705212+00	0	1	healthy
2459	3	2026-06-24 04:49:16.705212+00	0	1	healthy
2460	4	2026-06-24 04:49:16.705212+00	0	1	healthy
2461	1	2026-06-24 04:50:16.706565+00	0	1	healthy
2462	5	2026-06-24 04:50:16.706565+00	0	1	healthy
2463	2	2026-06-24 04:50:16.706565+00	0	1	healthy
2464	3	2026-06-24 04:50:16.706565+00	0	1	healthy
2465	4	2026-06-24 04:50:16.706565+00	0	1	healthy
2466	1	2026-06-24 04:51:16.708493+00	0	1	healthy
2467	5	2026-06-24 04:51:16.708493+00	0	1	healthy
2468	2	2026-06-24 04:51:16.708493+00	0	1	healthy
2469	3	2026-06-24 04:51:16.708493+00	0	1	healthy
2470	4	2026-06-24 04:51:16.708493+00	0	1	healthy
2471	1	2026-06-24 04:52:16.87629+00	0	1	healthy
2472	5	2026-06-24 04:52:16.87629+00	0	1	healthy
2473	2	2026-06-24 04:52:16.87629+00	0	1	healthy
2474	3	2026-06-24 04:52:16.87629+00	0	1	healthy
2475	4	2026-06-24 04:52:16.87629+00	0	1	healthy
2476	1	2026-06-24 04:53:16.706638+00	0	1	healthy
2477	5	2026-06-24 04:53:16.706638+00	0	1	healthy
2478	2	2026-06-24 04:53:16.706638+00	0	1	healthy
2479	3	2026-06-24 04:53:16.706638+00	0	1	healthy
2480	4	2026-06-24 04:53:16.706638+00	0	1	healthy
2481	1	2026-06-24 04:54:16.706493+00	0	1	healthy
2482	5	2026-06-24 04:54:16.706493+00	0	1	healthy
2483	2	2026-06-24 04:54:16.706493+00	0	1	healthy
2484	3	2026-06-24 04:54:16.706493+00	0	1	healthy
2485	4	2026-06-24 04:54:16.706493+00	0	1	healthy
2486	1	2026-06-24 04:55:16.70612+00	0	1	healthy
2487	5	2026-06-24 04:55:16.70612+00	0	1	healthy
2488	2	2026-06-24 04:55:16.70612+00	0	1	healthy
2489	3	2026-06-24 04:55:16.70612+00	0	1	healthy
2490	4	2026-06-24 04:55:16.70612+00	0	1	healthy
2491	1	2026-06-24 04:56:16.710329+00	0	1	healthy
2492	5	2026-06-24 04:56:16.710329+00	0	1	healthy
2493	2	2026-06-24 04:56:16.710329+00	0	1	healthy
2494	3	2026-06-24 04:56:16.710329+00	0	1	healthy
2495	4	2026-06-24 04:56:16.710329+00	0	1	healthy
2496	1	2026-06-24 04:57:16.705255+00	0	1	healthy
2497	5	2026-06-24 04:57:16.705255+00	0	1	healthy
2498	2	2026-06-24 04:57:16.705255+00	0	1	healthy
2499	3	2026-06-24 04:57:16.705255+00	0	1	healthy
2500	4	2026-06-24 04:57:16.705255+00	0	1	healthy
2501	1	2026-06-24 04:58:16.706397+00	0	1	healthy
2502	5	2026-06-24 04:58:16.706397+00	0	1	healthy
2503	2	2026-06-24 04:58:16.706397+00	0	1	healthy
2504	3	2026-06-24 04:58:16.706397+00	0	1	healthy
2505	4	2026-06-24 04:58:16.706397+00	0	1	healthy
2506	1	2026-06-24 04:59:16.706714+00	0	1	healthy
2507	5	2026-06-24 04:59:16.706714+00	0	1	healthy
2508	2	2026-06-24 04:59:16.706714+00	0	1	healthy
2509	3	2026-06-24 04:59:16.706714+00	0	1	healthy
2510	4	2026-06-24 04:59:16.706714+00	0	1	healthy
2511	1	2026-06-24 05:00:16.706153+00	0	1	healthy
2512	5	2026-06-24 05:00:16.706153+00	0	1	healthy
2513	2	2026-06-24 05:00:16.706153+00	0	1	healthy
2514	3	2026-06-24 05:00:16.706153+00	0	1	healthy
2515	4	2026-06-24 05:00:16.706153+00	0	1	healthy
2516	1	2026-06-24 05:01:16.707595+00	0	1	healthy
2517	5	2026-06-24 05:01:16.707595+00	0	1	healthy
2518	2	2026-06-24 05:01:16.707595+00	0	1	healthy
2519	3	2026-06-24 05:01:16.707595+00	0	1	healthy
2520	4	2026-06-24 05:01:16.707595+00	0	1	healthy
2521	1	2026-06-24 05:02:16.705523+00	0	1	healthy
2522	5	2026-06-24 05:02:16.705523+00	0	1	healthy
2523	2	2026-06-24 05:02:16.705523+00	0	1	healthy
2524	3	2026-06-24 05:02:16.705523+00	0	1	healthy
2525	4	2026-06-24 05:02:16.705523+00	0	1	healthy
2526	1	2026-06-24 05:03:16.706933+00	0	1	healthy
2527	5	2026-06-24 05:03:16.706933+00	0	1	healthy
2528	2	2026-06-24 05:03:16.706933+00	0	1	healthy
2529	3	2026-06-24 05:03:16.706933+00	0	1	healthy
2530	4	2026-06-24 05:03:16.706933+00	0	1	healthy
2531	1	2026-06-24 05:04:16.705752+00	0	1	healthy
2532	5	2026-06-24 05:04:16.705752+00	0	1	healthy
2533	2	2026-06-24 05:04:16.705752+00	0	1	healthy
2534	3	2026-06-24 05:04:16.705752+00	0	1	healthy
2535	4	2026-06-24 05:04:16.705752+00	0	1	healthy
2536	1	2026-06-24 05:05:16.706343+00	0	1	healthy
2537	5	2026-06-24 05:05:16.706343+00	0	1	healthy
2538	2	2026-06-24 05:05:16.706343+00	0	1	healthy
2539	3	2026-06-24 05:05:16.706343+00	0	1	healthy
2540	4	2026-06-24 05:05:16.706343+00	0	1	healthy
2541	1	2026-06-24 05:06:16.706282+00	0	1	healthy
2542	5	2026-06-24 05:06:16.706282+00	0	1	healthy
2543	2	2026-06-24 05:06:16.706282+00	0	1	healthy
2544	3	2026-06-24 05:06:16.706282+00	0	1	healthy
2545	4	2026-06-24 05:06:16.706282+00	0	1	healthy
2546	1	2026-06-24 05:07:16.70657+00	0	1	healthy
2547	5	2026-06-24 05:07:16.70657+00	0	1	healthy
2548	2	2026-06-24 05:07:16.70657+00	0	1	healthy
2549	3	2026-06-24 05:07:16.70657+00	0	1	healthy
2550	4	2026-06-24 05:07:16.70657+00	0	1	healthy
2551	1	2026-06-24 05:08:16.706851+00	0	1	healthy
2552	5	2026-06-24 05:08:16.706851+00	0	1	healthy
2553	2	2026-06-24 05:08:16.706851+00	0	1	healthy
2554	3	2026-06-24 05:08:16.706851+00	0	1	healthy
2555	4	2026-06-24 05:08:16.706851+00	0	1	healthy
2556	1	2026-06-24 05:09:16.706417+00	0	1	healthy
2557	5	2026-06-24 05:09:16.706417+00	0	1	healthy
2558	2	2026-06-24 05:09:16.706417+00	0	1	healthy
2559	3	2026-06-24 05:09:16.706417+00	0	1	healthy
2560	4	2026-06-24 05:09:16.706417+00	0	1	healthy
2561	1	2026-06-24 05:10:16.705991+00	0	1	healthy
2562	5	2026-06-24 05:10:16.705991+00	0	1	healthy
2563	2	2026-06-24 05:10:16.705991+00	0	1	healthy
2564	3	2026-06-24 05:10:16.705991+00	0	1	healthy
2565	4	2026-06-24 05:10:16.705991+00	0	1	healthy
2581	1	2026-06-24 05:37:16.706248+00	0	1	healthy
2582	5	2026-06-24 05:37:16.706248+00	0	1	healthy
2583	2	2026-06-24 05:37:16.706248+00	0	1	healthy
2584	3	2026-06-24 05:37:16.706248+00	0	1	healthy
2585	4	2026-06-24 05:37:16.706248+00	0	1	healthy
2606	1	2026-06-24 05:42:16.706309+00	0	1	healthy
2607	5	2026-06-24 05:42:16.706309+00	0	1	healthy
2608	2	2026-06-24 05:42:16.706309+00	0	1	healthy
2609	3	2026-06-24 05:42:16.706309+00	0	1	healthy
2610	4	2026-06-24 05:42:16.706309+00	0	1	healthy
2746	1	2026-06-24 06:33:14.204152+00	0	1	healthy
2747	5	2026-06-24 06:33:14.204152+00	0	1	healthy
2748	2	2026-06-24 06:33:14.204152+00	0	1	healthy
2749	3	2026-06-24 06:33:14.204152+00	0	1	healthy
2750	4	2026-06-24 06:33:14.204152+00	0	1	healthy
2756	1	2026-06-24 06:35:14.205293+00	0	1	healthy
2757	5	2026-06-24 06:35:14.205293+00	0	1	healthy
2758	2	2026-06-24 06:35:14.205293+00	0	1	healthy
2759	3	2026-06-24 06:35:14.205293+00	0	1	healthy
2760	4	2026-06-24 06:35:14.205293+00	0	1	healthy
2801	1	2026-06-24 06:44:14.203263+00	0	1	healthy
2802	5	2026-06-24 06:44:14.203263+00	0	1	healthy
2803	2	2026-06-24 06:44:14.203263+00	0	1	healthy
2804	3	2026-06-24 06:44:14.203263+00	0	1	healthy
2805	4	2026-06-24 06:44:14.203263+00	0	1	healthy
2906	1	2026-06-24 07:05:39.179082+00	0	1	healthy
2907	5	2026-06-24 07:05:39.179082+00	0	1	healthy
2908	2	2026-06-24 07:05:39.179082+00	0	1	healthy
2909	3	2026-06-24 07:05:39.179082+00	0	1	healthy
2910	4	2026-06-24 07:05:39.179082+00	0	1	healthy
2921	1	2026-06-24 07:08:39.179642+00	0	1	healthy
2922	5	2026-06-24 07:08:39.179642+00	0	1	healthy
2923	2	2026-06-24 07:08:39.179642+00	0	1	healthy
2924	3	2026-06-24 07:08:39.179642+00	0	1	healthy
2925	4	2026-06-24 07:08:39.179642+00	0	1	healthy
2961	1	2026-06-24 07:16:39.181458+00	0	1	healthy
2962	5	2026-06-24 07:16:39.181458+00	0	1	healthy
2963	2	2026-06-24 07:16:39.181458+00	0	1	healthy
2964	3	2026-06-24 07:16:39.181458+00	0	1	healthy
2965	4	2026-06-24 07:16:39.181458+00	0	1	healthy
3026	1	2026-06-24 07:29:39.372018+00	0	1	healthy
3027	5	2026-06-24 07:29:39.372018+00	0	1	healthy
3028	2	2026-06-24 07:29:39.372018+00	0	1	healthy
3029	3	2026-06-24 07:29:39.372018+00	0	1	healthy
3030	4	2026-06-24 07:29:39.372018+00	0	1	healthy
3036	1	2026-06-24 07:31:39.181494+00	0	1	healthy
3037	5	2026-06-24 07:31:39.181494+00	0	1	healthy
3038	2	2026-06-24 07:31:39.181494+00	0	1	healthy
3039	3	2026-06-24 07:31:39.181494+00	0	1	healthy
3040	4	2026-06-24 07:31:39.181494+00	0	1	healthy
3071	1	2026-06-24 07:38:39.178747+00	0	1	healthy
3072	5	2026-06-24 07:38:39.178747+00	0	1	healthy
3073	2	2026-06-24 07:38:39.178747+00	0	1	healthy
3074	3	2026-06-24 07:38:39.178747+00	0	1	healthy
3075	4	2026-06-24 07:38:39.178747+00	0	1	healthy
3161	1	2026-06-24 07:56:39.185809+00	0	1	healthy
3162	5	2026-06-24 07:56:39.185809+00	0	1	healthy
3163	2	2026-06-24 07:56:39.185809+00	0	1	healthy
3164	3	2026-06-24 07:56:39.185809+00	0	1	healthy
3165	4	2026-06-24 07:56:39.185809+00	0	1	healthy
3216	1	2026-06-24 08:07:39.183472+00	0	1	healthy
3217	5	2026-06-24 08:07:39.183472+00	0	1	healthy
3218	2	2026-06-24 08:07:39.183472+00	0	1	healthy
3219	3	2026-06-24 08:07:39.183472+00	0	1	healthy
3220	4	2026-06-24 08:07:39.183472+00	0	1	healthy
3236	1	2026-06-24 08:11:39.179891+00	0	1	healthy
3237	5	2026-06-24 08:11:39.179891+00	0	1	healthy
3238	2	2026-06-24 08:11:39.179891+00	0	1	healthy
3239	3	2026-06-24 08:11:39.179891+00	0	1	healthy
3240	4	2026-06-24 08:11:39.179891+00	0	1	healthy
3251	1	2026-06-24 08:14:39.181925+00	0	1	healthy
3252	5	2026-06-24 08:14:39.181925+00	0	1	healthy
3253	2	2026-06-24 08:14:39.181925+00	0	1	healthy
3254	3	2026-06-24 08:14:39.181925+00	0	1	healthy
3255	4	2026-06-24 08:14:39.181925+00	0	1	healthy
3266	1	2026-06-24 08:17:39.183503+00	0	1	healthy
3267	5	2026-06-24 08:17:39.183503+00	0	1	healthy
3268	2	2026-06-24 08:17:39.183503+00	0	1	healthy
3269	3	2026-06-24 08:17:39.183503+00	0	1	healthy
3270	4	2026-06-24 08:17:39.183503+00	0	1	healthy
3291	1	2026-06-24 08:22:39.182516+00	0	1	healthy
3292	5	2026-06-24 08:22:39.182516+00	0	1	healthy
3293	2	2026-06-24 08:22:39.182516+00	0	1	healthy
3294	3	2026-06-24 08:22:39.182516+00	0	1	healthy
3295	4	2026-06-24 08:22:39.182516+00	0	1	healthy
3311	1	2026-06-24 08:26:39.179381+00	0	1	healthy
3312	5	2026-06-24 08:26:39.179381+00	0	1	healthy
3313	2	2026-06-24 08:26:39.179381+00	0	1	healthy
3314	3	2026-06-24 08:26:39.179381+00	0	1	healthy
3315	4	2026-06-24 08:26:39.179381+00	0	1	healthy
3336	1	2026-06-24 08:31:39.179554+00	0	1	healthy
3337	5	2026-06-24 08:31:39.179554+00	0	1	healthy
3338	2	2026-06-24 08:31:39.179554+00	0	1	healthy
3339	3	2026-06-24 08:31:39.179554+00	0	1	healthy
3340	4	2026-06-24 08:31:39.179554+00	0	1	healthy
3351	1	2026-06-24 08:34:39.180678+00	0	1	healthy
3352	5	2026-06-24 08:34:39.180678+00	0	1	healthy
3353	2	2026-06-24 08:34:39.180678+00	0	1	healthy
3354	3	2026-06-24 08:34:39.180678+00	0	1	healthy
3355	4	2026-06-24 08:34:39.180678+00	0	1	healthy
3381	1	2026-06-24 08:40:39.181546+00	0	1	healthy
3382	5	2026-06-24 08:40:39.181546+00	0	1	healthy
3383	2	2026-06-24 08:40:39.181546+00	0	1	healthy
3384	3	2026-06-24 08:40:39.181546+00	0	1	healthy
3385	4	2026-06-24 08:40:39.181546+00	0	1	healthy
3411	1	2026-06-24 08:46:39.18012+00	0	1	healthy
3412	5	2026-06-24 08:46:39.18012+00	0	1	healthy
3413	2	2026-06-24 08:46:39.18012+00	0	1	healthy
3414	3	2026-06-24 08:46:39.18012+00	0	1	healthy
3415	4	2026-06-24 08:46:39.18012+00	0	1	healthy
3431	1	2026-06-24 08:50:39.178513+00	0	1	healthy
3432	5	2026-06-24 08:50:39.178513+00	0	1	healthy
3433	2	2026-06-24 08:50:39.178513+00	0	1	healthy
3434	3	2026-06-24 08:50:39.178513+00	0	1	healthy
3435	4	2026-06-24 08:50:39.178513+00	0	1	healthy
2566	1	2026-06-24 05:11:16.725876+00	0	1	healthy
2567	5	2026-06-24 05:11:16.725876+00	0	1	healthy
2568	2	2026-06-24 05:11:16.725876+00	0	1	healthy
2569	3	2026-06-24 05:11:16.725876+00	0	1	healthy
2570	4	2026-06-24 05:11:16.725876+00	0	1	healthy
2586	1	2026-06-24 05:38:16.705296+00	0	1	healthy
2587	5	2026-06-24 05:38:16.705296+00	0	1	healthy
2588	2	2026-06-24 05:38:16.705296+00	0	1	healthy
2589	3	2026-06-24 05:38:16.705296+00	0	1	healthy
2590	4	2026-06-24 05:38:16.705296+00	0	1	healthy
2601	1	2026-06-24 05:41:16.708862+00	0	1	healthy
2602	5	2026-06-24 05:41:16.708862+00	0	1	healthy
2603	2	2026-06-24 05:41:16.708862+00	0	1	healthy
2604	3	2026-06-24 05:41:16.708862+00	0	1	healthy
2605	4	2026-06-24 05:41:16.708862+00	0	1	healthy
2766	1	2026-06-24 06:37:14.212105+00	0	1	healthy
2767	5	2026-06-24 06:37:14.212105+00	0	1	healthy
2768	2	2026-06-24 06:37:14.212105+00	0	1	healthy
2769	3	2026-06-24 06:37:14.212105+00	0	1	healthy
2770	4	2026-06-24 06:37:14.212105+00	0	1	healthy
2821	1	2026-06-24 06:48:39.242076+00	0	1	healthy
2822	5	2026-06-24 06:48:39.242076+00	0	1	healthy
2823	2	2026-06-24 06:48:39.242076+00	0	1	healthy
2824	3	2026-06-24 06:48:39.242076+00	0	1	healthy
2825	4	2026-06-24 06:48:39.242076+00	0	1	healthy
2826	1	2026-06-24 06:49:39.180365+00	0	1	healthy
2827	5	2026-06-24 06:49:39.180365+00	0	1	healthy
2828	2	2026-06-24 06:49:39.180365+00	0	1	healthy
2829	3	2026-06-24 06:49:39.180365+00	0	1	healthy
2830	4	2026-06-24 06:49:39.180365+00	0	1	healthy
2831	1	2026-06-24 06:50:39.178932+00	0	1	healthy
2832	5	2026-06-24 06:50:39.178932+00	0	1	healthy
2833	2	2026-06-24 06:50:39.178932+00	0	1	healthy
2834	3	2026-06-24 06:50:39.178932+00	0	1	healthy
2835	4	2026-06-24 06:50:39.178932+00	0	1	healthy
2836	1	2026-06-24 06:51:39.184313+00	0	1	healthy
2837	5	2026-06-24 06:51:39.184313+00	0	1	healthy
2838	2	2026-06-24 06:51:39.184313+00	0	1	healthy
2839	3	2026-06-24 06:51:39.184313+00	0	1	healthy
2840	4	2026-06-24 06:51:39.184313+00	0	1	healthy
2841	1	2026-06-24 06:52:39.178668+00	0	1	healthy
2842	5	2026-06-24 06:52:39.178668+00	0	1	healthy
2843	2	2026-06-24 06:52:39.178668+00	0	1	healthy
2844	3	2026-06-24 06:52:39.178668+00	0	1	healthy
2845	4	2026-06-24 06:52:39.178668+00	0	1	healthy
3096	1	2026-06-24 07:43:39.180345+00	0	1	healthy
3097	5	2026-06-24 07:43:39.180345+00	0	1	healthy
3098	2	2026-06-24 07:43:39.180345+00	0	1	healthy
3099	3	2026-06-24 07:43:39.180345+00	0	1	healthy
3100	4	2026-06-24 07:43:39.180345+00	0	1	healthy
3186	1	2026-06-24 08:01:39.181929+00	0	1	healthy
3187	5	2026-06-24 08:01:39.181929+00	0	1	healthy
3188	2	2026-06-24 08:01:39.181929+00	0	1	healthy
3189	3	2026-06-24 08:01:39.181929+00	0	1	healthy
3190	4	2026-06-24 08:01:39.181929+00	0	1	healthy
3191	1	2026-06-24 08:02:39.1815+00	0	1	healthy
3192	5	2026-06-24 08:02:39.1815+00	0	1	healthy
3193	2	2026-06-24 08:02:39.1815+00	0	1	healthy
3194	3	2026-06-24 08:02:39.1815+00	0	1	healthy
3195	4	2026-06-24 08:02:39.1815+00	0	1	healthy
3206	1	2026-06-24 08:05:39.180096+00	0	1	healthy
3207	5	2026-06-24 08:05:39.180096+00	0	1	healthy
3208	2	2026-06-24 08:05:39.180096+00	0	1	healthy
3209	3	2026-06-24 08:05:39.180096+00	0	1	healthy
3210	4	2026-06-24 08:05:39.180096+00	0	1	healthy
3241	1	2026-06-24 08:12:39.18078+00	0	1	healthy
3242	5	2026-06-24 08:12:39.18078+00	0	1	healthy
3243	2	2026-06-24 08:12:39.18078+00	0	1	healthy
3244	3	2026-06-24 08:12:39.18078+00	0	1	healthy
3245	4	2026-06-24 08:12:39.18078+00	0	1	healthy
3261	1	2026-06-24 08:16:39.180989+00	0	1	healthy
3262	5	2026-06-24 08:16:39.180989+00	0	1	healthy
3263	2	2026-06-24 08:16:39.180989+00	0	1	healthy
3264	3	2026-06-24 08:16:39.180989+00	0	1	healthy
3265	4	2026-06-24 08:16:39.180989+00	0	1	healthy
3386	1	2026-06-24 08:41:39.184974+00	0	1	healthy
3387	5	2026-06-24 08:41:39.184974+00	0	1	healthy
3388	2	2026-06-24 08:41:39.184974+00	0	1	healthy
3389	3	2026-06-24 08:41:39.184974+00	0	1	healthy
3390	4	2026-06-24 08:41:39.184974+00	0	1	healthy
3396	1	2026-06-24 08:43:39.179017+00	0	1	healthy
3397	5	2026-06-24 08:43:39.179017+00	0	1	healthy
3398	2	2026-06-24 08:43:39.179017+00	0	1	healthy
3399	3	2026-06-24 08:43:39.179017+00	0	1	healthy
3400	4	2026-06-24 08:43:39.179017+00	0	1	healthy
3436	1	2026-06-24 08:51:39.179214+00	0	1	healthy
3437	5	2026-06-24 08:51:39.179214+00	0	1	healthy
3438	2	2026-06-24 08:51:39.179214+00	0	1	healthy
3439	3	2026-06-24 08:51:39.179214+00	0	1	healthy
3440	4	2026-06-24 08:51:39.179214+00	0	1	healthy
3441	1	2026-06-24 08:52:39.180919+00	0	1	healthy
3442	5	2026-06-24 08:52:39.180919+00	0	1	healthy
3443	2	2026-06-24 08:52:39.180919+00	0	1	healthy
3444	3	2026-06-24 08:52:39.180919+00	0	1	healthy
3445	4	2026-06-24 08:52:39.180919+00	0	1	healthy
3456	1	2026-06-24 08:55:39.183597+00	0	1	healthy
3457	5	2026-06-24 08:55:39.183597+00	0	1	healthy
3458	2	2026-06-24 08:55:39.183597+00	0	1	healthy
3459	3	2026-06-24 08:55:39.183597+00	0	1	healthy
3460	4	2026-06-24 08:55:39.183597+00	0	1	healthy
3461	1	2026-06-24 08:56:39.180518+00	0	1	healthy
3462	5	2026-06-24 08:56:39.180518+00	0	1	healthy
3463	2	2026-06-24 08:56:39.180518+00	0	1	healthy
3464	3	2026-06-24 08:56:39.180518+00	0	1	healthy
3465	4	2026-06-24 08:56:39.180518+00	0	1	healthy
3466	1	2026-06-24 08:57:39.18064+00	0	1	healthy
3467	5	2026-06-24 08:57:39.18064+00	0	1	healthy
3468	2	2026-06-24 08:57:39.18064+00	0	1	healthy
3469	3	2026-06-24 08:57:39.18064+00	0	1	healthy
3470	4	2026-06-24 08:57:39.18064+00	0	1	healthy
3471	1	2026-06-24 08:58:39.181571+00	0	1	healthy
3472	5	2026-06-24 08:58:39.181571+00	0	1	healthy
3473	2	2026-06-24 08:58:39.181571+00	0	1	healthy
3474	3	2026-06-24 08:58:39.181571+00	0	1	healthy
3475	4	2026-06-24 08:58:39.181571+00	0	1	healthy
3476	1	2026-06-24 08:59:39.180966+00	0	1	healthy
3477	5	2026-06-24 08:59:39.180966+00	0	1	healthy
3478	2	2026-06-24 08:59:39.180966+00	0	1	healthy
3479	3	2026-06-24 08:59:39.180966+00	0	1	healthy
3480	4	2026-06-24 08:59:39.180966+00	0	1	healthy
2571	1	2026-06-24 05:12:16.705928+00	0	1	healthy
2572	5	2026-06-24 05:12:16.705928+00	0	1	healthy
2573	2	2026-06-24 05:12:16.705928+00	0	1	healthy
2574	3	2026-06-24 05:12:16.705928+00	0	1	healthy
2575	4	2026-06-24 05:12:16.705928+00	0	1	healthy
2596	1	2026-06-24 05:40:16.706845+00	0	1	healthy
2597	5	2026-06-24 05:40:16.706845+00	0	1	healthy
2598	2	2026-06-24 05:40:16.706845+00	0	1	healthy
2599	3	2026-06-24 05:40:16.706845+00	0	1	healthy
2600	4	2026-06-24 05:40:16.706845+00	0	1	healthy
2771	1	2026-06-24 06:38:14.202677+00	0	1	healthy
2772	5	2026-06-24 06:38:14.202677+00	0	1	healthy
2773	2	2026-06-24 06:38:14.202677+00	0	1	healthy
2774	3	2026-06-24 06:38:14.202677+00	0	1	healthy
2775	4	2026-06-24 06:38:14.202677+00	0	1	healthy
2846	1	2026-06-24 06:53:39.179038+00	0	1	healthy
2847	5	2026-06-24 06:53:39.179038+00	0	1	healthy
2848	2	2026-06-24 06:53:39.179038+00	0	1	healthy
2849	3	2026-06-24 06:53:39.179038+00	0	1	healthy
2850	4	2026-06-24 06:53:39.179038+00	0	1	healthy
2856	1	2026-06-24 06:55:39.179162+00	0	1	healthy
2857	5	2026-06-24 06:55:39.179162+00	0	1	healthy
2858	2	2026-06-24 06:55:39.179162+00	0	1	healthy
2859	3	2026-06-24 06:55:39.179162+00	0	1	healthy
2860	4	2026-06-24 06:55:39.179162+00	0	1	healthy
2866	1	2026-06-24 06:57:39.185362+00	0	1	healthy
2867	5	2026-06-24 06:57:39.185362+00	0	1	healthy
2868	2	2026-06-24 06:57:39.185362+00	0	1	healthy
2869	3	2026-06-24 06:57:39.185362+00	0	1	healthy
2870	4	2026-06-24 06:57:39.185362+00	0	1	healthy
2876	1	2026-06-24 06:59:39.179889+00	0	1	healthy
2877	5	2026-06-24 06:59:39.179889+00	0	1	healthy
2878	2	2026-06-24 06:59:39.179889+00	0	1	healthy
2879	3	2026-06-24 06:59:39.179889+00	0	1	healthy
2880	4	2026-06-24 06:59:39.179889+00	0	1	healthy
2886	1	2026-06-24 07:01:39.181225+00	0	1	healthy
2887	5	2026-06-24 07:01:39.181225+00	0	1	healthy
2888	2	2026-06-24 07:01:39.181225+00	0	1	healthy
2889	3	2026-06-24 07:01:39.181225+00	0	1	healthy
2890	4	2026-06-24 07:01:39.181225+00	0	1	healthy
2916	1	2026-06-24 07:07:39.211304+00	0	1	healthy
2917	5	2026-06-24 07:07:39.211304+00	0	1	healthy
2918	2	2026-06-24 07:07:39.211304+00	0	1	healthy
2919	3	2026-06-24 07:07:39.211304+00	0	1	healthy
2920	4	2026-06-24 07:07:39.211304+00	0	1	healthy
2926	1	2026-06-24 07:09:39.181362+00	0	1	healthy
2927	5	2026-06-24 07:09:39.181362+00	0	1	healthy
2928	2	2026-06-24 07:09:39.181362+00	0	1	healthy
2929	3	2026-06-24 07:09:39.181362+00	0	1	healthy
2930	4	2026-06-24 07:09:39.181362+00	0	1	healthy
2931	1	2026-06-24 07:10:39.179659+00	0	1	healthy
2932	5	2026-06-24 07:10:39.179659+00	0	1	healthy
2933	2	2026-06-24 07:10:39.179659+00	0	1	healthy
2934	3	2026-06-24 07:10:39.179659+00	0	1	healthy
2935	4	2026-06-24 07:10:39.179659+00	0	1	healthy
2971	1	2026-06-24 07:18:39.180495+00	0	1	healthy
2972	5	2026-06-24 07:18:39.180495+00	0	1	healthy
2973	2	2026-06-24 07:18:39.180495+00	0	1	healthy
2974	3	2026-06-24 07:18:39.180495+00	0	1	healthy
2975	4	2026-06-24 07:18:39.180495+00	0	1	healthy
2986	1	2026-06-24 07:21:39.179888+00	0	1	healthy
2987	5	2026-06-24 07:21:39.179888+00	0	1	healthy
2988	2	2026-06-24 07:21:39.179888+00	0	1	healthy
2989	3	2026-06-24 07:21:39.179888+00	0	1	healthy
2990	4	2026-06-24 07:21:39.179888+00	0	1	healthy
3001	1	2026-06-24 07:24:39.179983+00	0	1	healthy
3002	5	2026-06-24 07:24:39.179983+00	0	1	healthy
3003	2	2026-06-24 07:24:39.179983+00	0	1	healthy
3004	3	2026-06-24 07:24:39.179983+00	0	1	healthy
3005	4	2026-06-24 07:24:39.179983+00	0	1	healthy
3031	1	2026-06-24 07:30:39.181167+00	0	1	healthy
3032	5	2026-06-24 07:30:39.181167+00	0	1	healthy
3033	2	2026-06-24 07:30:39.181167+00	0	1	healthy
3034	3	2026-06-24 07:30:39.181167+00	0	1	healthy
3035	4	2026-06-24 07:30:39.181167+00	0	1	healthy
3041	1	2026-06-24 07:32:39.185552+00	0	1	healthy
3042	5	2026-06-24 07:32:39.185552+00	0	1	healthy
3043	2	2026-06-24 07:32:39.185552+00	0	1	healthy
3044	3	2026-06-24 07:32:39.185552+00	0	1	healthy
3045	4	2026-06-24 07:32:39.185552+00	0	1	healthy
3066	1	2026-06-24 07:37:39.182644+00	0	1	healthy
3067	5	2026-06-24 07:37:39.182644+00	0	1	healthy
3068	2	2026-06-24 07:37:39.182644+00	0	1	healthy
3069	3	2026-06-24 07:37:39.182644+00	0	1	healthy
3070	4	2026-06-24 07:37:39.182644+00	0	1	healthy
3086	1	2026-06-24 07:41:39.17971+00	0	1	healthy
3087	5	2026-06-24 07:41:39.17971+00	0	1	healthy
3088	2	2026-06-24 07:41:39.17971+00	0	1	healthy
3089	3	2026-06-24 07:41:39.17971+00	0	1	healthy
3090	4	2026-06-24 07:41:39.17971+00	0	1	healthy
3106	1	2026-06-24 07:45:39.183383+00	0	1	healthy
3107	5	2026-06-24 07:45:39.183383+00	0	1	healthy
3108	2	2026-06-24 07:45:39.183383+00	0	1	healthy
3109	3	2026-06-24 07:45:39.183383+00	0	1	healthy
3110	4	2026-06-24 07:45:39.183383+00	0	1	healthy
3196	1	2026-06-24 08:03:39.180884+00	0	1	healthy
3197	5	2026-06-24 08:03:39.180884+00	0	1	healthy
3198	2	2026-06-24 08:03:39.180884+00	0	1	healthy
3199	3	2026-06-24 08:03:39.180884+00	0	1	healthy
3200	4	2026-06-24 08:03:39.180884+00	0	1	healthy
3231	1	2026-06-24 08:10:39.181902+00	0	1	healthy
3232	5	2026-06-24 08:10:39.181902+00	0	1	healthy
3233	2	2026-06-24 08:10:39.181902+00	0	1	healthy
3234	3	2026-06-24 08:10:39.181902+00	0	1	healthy
3235	4	2026-06-24 08:10:39.181902+00	0	1	healthy
3246	1	2026-06-24 08:13:39.180667+00	0	1	healthy
3247	5	2026-06-24 08:13:39.180667+00	0	1	healthy
3248	2	2026-06-24 08:13:39.180667+00	0	1	healthy
3249	3	2026-06-24 08:13:39.180667+00	0	1	healthy
3250	4	2026-06-24 08:13:39.180667+00	0	1	healthy
3271	1	2026-06-24 08:18:39.180149+00	0	1	healthy
3272	5	2026-06-24 08:18:39.180149+00	0	1	healthy
3273	2	2026-06-24 08:18:39.180149+00	0	1	healthy
3274	3	2026-06-24 08:18:39.180149+00	0	1	healthy
3275	4	2026-06-24 08:18:39.180149+00	0	1	healthy
3306	1	2026-06-24 08:25:39.179576+00	0	1	healthy
3307	5	2026-06-24 08:25:39.179576+00	0	1	healthy
3308	2	2026-06-24 08:25:39.179576+00	0	1	healthy
3309	3	2026-06-24 08:25:39.179576+00	0	1	healthy
3310	4	2026-06-24 08:25:39.179576+00	0	1	healthy
2576	1	2026-06-24 05:13:16.706795+00	0	1	healthy
2577	5	2026-06-24 05:13:16.706795+00	0	1	healthy
2578	2	2026-06-24 05:13:16.706795+00	0	1	healthy
2579	3	2026-06-24 05:13:16.706795+00	0	1	healthy
2580	4	2026-06-24 05:13:16.706795+00	0	1	healthy
2611	1	2026-06-24 05:43:16.706031+00	0	1	healthy
2612	5	2026-06-24 05:43:16.706031+00	0	1	healthy
2613	2	2026-06-24 05:43:16.706031+00	0	1	healthy
2614	3	2026-06-24 05:43:16.706031+00	0	1	healthy
2615	4	2026-06-24 05:43:16.706031+00	0	1	healthy
2776	1	2026-06-24 06:39:14.202593+00	0	1	healthy
2777	5	2026-06-24 06:39:14.202593+00	0	1	healthy
2778	2	2026-06-24 06:39:14.202593+00	0	1	healthy
2779	3	2026-06-24 06:39:14.202593+00	0	1	healthy
2780	4	2026-06-24 06:39:14.202593+00	0	1	healthy
2806	1	2026-06-24 06:45:14.211873+00	0	1	healthy
2807	5	2026-06-24 06:45:14.211873+00	0	1	healthy
2808	2	2026-06-24 06:45:14.211873+00	0	1	healthy
2809	3	2026-06-24 06:45:14.211873+00	0	1	healthy
2810	4	2026-06-24 06:45:14.211873+00	0	1	healthy
2811	1	2026-06-24 06:46:14.204542+00	0	1	healthy
2812	5	2026-06-24 06:46:14.204542+00	0	1	healthy
2813	2	2026-06-24 06:46:14.204542+00	0	1	healthy
2814	3	2026-06-24 06:46:14.204542+00	0	1	healthy
2815	4	2026-06-24 06:46:14.204542+00	0	1	healthy
2851	1	2026-06-24 06:54:39.181377+00	0	1	healthy
2852	5	2026-06-24 06:54:39.181377+00	0	1	healthy
2853	2	2026-06-24 06:54:39.181377+00	0	1	healthy
2854	3	2026-06-24 06:54:39.181377+00	0	1	healthy
2855	4	2026-06-24 06:54:39.181377+00	0	1	healthy
2861	1	2026-06-24 06:56:39.179801+00	0	1	healthy
2862	5	2026-06-24 06:56:39.179801+00	0	1	healthy
2863	2	2026-06-24 06:56:39.179801+00	0	1	healthy
2864	3	2026-06-24 06:56:39.179801+00	0	1	healthy
2865	4	2026-06-24 06:56:39.179801+00	0	1	healthy
2881	1	2026-06-24 07:00:39.180285+00	0	1	healthy
2882	5	2026-06-24 07:00:39.180285+00	0	1	healthy
2883	2	2026-06-24 07:00:39.180285+00	0	1	healthy
2884	3	2026-06-24 07:00:39.180285+00	0	1	healthy
2885	4	2026-06-24 07:00:39.180285+00	0	1	healthy
2896	1	2026-06-24 07:03:39.180395+00	0	1	healthy
2897	5	2026-06-24 07:03:39.180395+00	0	1	healthy
2898	2	2026-06-24 07:03:39.180395+00	0	1	healthy
2899	3	2026-06-24 07:03:39.180395+00	0	1	healthy
2900	4	2026-06-24 07:03:39.180395+00	0	1	healthy
2956	1	2026-06-24 07:15:39.180707+00	0	1	healthy
2957	5	2026-06-24 07:15:39.180707+00	0	1	healthy
2958	2	2026-06-24 07:15:39.180707+00	0	1	healthy
2959	3	2026-06-24 07:15:39.180707+00	0	1	healthy
2960	4	2026-06-24 07:15:39.180707+00	0	1	healthy
2981	1	2026-06-24 07:20:39.187446+00	0	1	healthy
2982	5	2026-06-24 07:20:39.187446+00	0	1	healthy
2983	2	2026-06-24 07:20:39.187446+00	0	1	healthy
2984	3	2026-06-24 07:20:39.187446+00	0	1	healthy
2985	4	2026-06-24 07:20:39.187446+00	0	1	healthy
2996	1	2026-06-24 07:23:39.179137+00	0	1	healthy
2997	5	2026-06-24 07:23:39.179137+00	0	1	healthy
2998	2	2026-06-24 07:23:39.179137+00	0	1	healthy
2999	3	2026-06-24 07:23:39.179137+00	0	1	healthy
3000	4	2026-06-24 07:23:39.179137+00	0	1	healthy
3051	1	2026-06-24 07:34:39.181103+00	0	1	healthy
3052	5	2026-06-24 07:34:39.181103+00	0	1	healthy
3053	2	2026-06-24 07:34:39.181103+00	0	1	healthy
3054	3	2026-06-24 07:34:39.181103+00	0	1	healthy
3055	4	2026-06-24 07:34:39.181103+00	0	1	healthy
3081	1	2026-06-24 07:40:39.182349+00	0	1	healthy
3082	5	2026-06-24 07:40:39.182349+00	0	1	healthy
3083	2	2026-06-24 07:40:39.182349+00	0	1	healthy
3084	3	2026-06-24 07:40:39.182349+00	0	1	healthy
3085	4	2026-06-24 07:40:39.182349+00	0	1	healthy
3111	1	2026-06-24 07:46:39.180978+00	0	1	healthy
3112	5	2026-06-24 07:46:39.180978+00	0	1	healthy
3113	2	2026-06-24 07:46:39.180978+00	0	1	healthy
3114	3	2026-06-24 07:46:39.180978+00	0	1	healthy
3115	4	2026-06-24 07:46:39.180978+00	0	1	healthy
3131	1	2026-06-24 07:50:39.179226+00	0	1	healthy
3132	5	2026-06-24 07:50:39.179226+00	0	1	healthy
3133	2	2026-06-24 07:50:39.179226+00	0	1	healthy
3134	3	2026-06-24 07:50:39.179226+00	0	1	healthy
3135	4	2026-06-24 07:50:39.179226+00	0	1	healthy
3141	1	2026-06-24 07:52:39.185358+00	0	1	healthy
3142	5	2026-06-24 07:52:39.185358+00	0	1	healthy
3143	2	2026-06-24 07:52:39.185358+00	0	1	healthy
3144	3	2026-06-24 07:52:39.185358+00	0	1	healthy
3145	4	2026-06-24 07:52:39.185358+00	0	1	healthy
3146	1	2026-06-24 07:53:39.229656+00	0	1	healthy
3147	5	2026-06-24 07:53:39.229656+00	0	1	healthy
3148	2	2026-06-24 07:53:39.229656+00	0	1	healthy
3149	3	2026-06-24 07:53:39.229656+00	0	1	healthy
3150	4	2026-06-24 07:53:39.229656+00	0	1	healthy
3156	1	2026-06-24 07:55:39.17964+00	0	1	healthy
3157	5	2026-06-24 07:55:39.17964+00	0	1	healthy
3158	2	2026-06-24 07:55:39.17964+00	0	1	healthy
3159	3	2026-06-24 07:55:39.17964+00	0	1	healthy
3160	4	2026-06-24 07:55:39.17964+00	0	1	healthy
3181	1	2026-06-24 08:00:39.193663+00	0	1	healthy
3182	5	2026-06-24 08:00:39.193663+00	0	1	healthy
3183	2	2026-06-24 08:00:39.193663+00	0	1	healthy
3184	3	2026-06-24 08:00:39.193663+00	0	1	healthy
3185	4	2026-06-24 08:00:39.193663+00	0	1	healthy
3286	1	2026-06-24 08:21:39.178646+00	0	1	healthy
3287	5	2026-06-24 08:21:39.178646+00	0	1	healthy
3288	2	2026-06-24 08:21:39.178646+00	0	1	healthy
3289	3	2026-06-24 08:21:39.178646+00	0	1	healthy
3290	4	2026-06-24 08:21:39.178646+00	0	1	healthy
3301	1	2026-06-24 08:24:39.180162+00	0	1	healthy
3302	5	2026-06-24 08:24:39.180162+00	0	1	healthy
3303	2	2026-06-24 08:24:39.180162+00	0	1	healthy
3304	3	2026-06-24 08:24:39.180162+00	0	1	healthy
3305	4	2026-06-24 08:24:39.180162+00	0	1	healthy
3371	1	2026-06-24 08:38:39.190853+00	0	1	healthy
3372	5	2026-06-24 08:38:39.190853+00	0	1	healthy
3373	2	2026-06-24 08:38:39.190853+00	0	1	healthy
3374	3	2026-06-24 08:38:39.190853+00	0	1	healthy
3375	4	2026-06-24 08:38:39.190853+00	0	1	healthy
3391	1	2026-06-24 08:42:39.179206+00	0	1	healthy
3392	5	2026-06-24 08:42:39.179206+00	0	1	healthy
3393	2	2026-06-24 08:42:39.179206+00	0	1	healthy
3394	3	2026-06-24 08:42:39.179206+00	0	1	healthy
3395	4	2026-06-24 08:42:39.179206+00	0	1	healthy
2591	1	2026-06-24 05:39:16.705546+00	0	1	healthy
2592	5	2026-06-24 05:39:16.705546+00	0	1	healthy
2593	2	2026-06-24 05:39:16.705546+00	0	1	healthy
2594	3	2026-06-24 05:39:16.705546+00	0	1	healthy
2595	4	2026-06-24 05:39:16.705546+00	0	1	healthy
2616	1	2026-06-24 05:44:16.705265+00	0	1	healthy
2617	5	2026-06-24 05:44:16.705265+00	0	1	healthy
2618	2	2026-06-24 05:44:16.705265+00	0	1	healthy
2619	3	2026-06-24 05:44:16.705265+00	0	1	healthy
2620	4	2026-06-24 05:44:16.705265+00	0	1	healthy
2621	1	2026-06-24 05:46:14.205715+00	0	1	healthy
2622	5	2026-06-24 05:46:14.205715+00	0	1	healthy
2623	2	2026-06-24 05:46:14.205715+00	0	1	healthy
2624	3	2026-06-24 05:46:14.205715+00	0	1	healthy
2625	4	2026-06-24 05:46:14.205715+00	0	1	healthy
2626	1	2026-06-24 05:47:14.203533+00	0	1	healthy
2627	5	2026-06-24 05:47:14.203533+00	0	1	healthy
2628	2	2026-06-24 05:47:14.203533+00	0	1	healthy
2629	3	2026-06-24 05:47:14.203533+00	0	1	healthy
2630	4	2026-06-24 05:47:14.203533+00	0	1	healthy
2631	1	2026-06-24 05:48:14.203284+00	0	1	healthy
2632	5	2026-06-24 05:48:14.203284+00	0	1	healthy
2633	2	2026-06-24 05:48:14.203284+00	0	1	healthy
2634	3	2026-06-24 05:48:14.203284+00	0	1	healthy
2635	4	2026-06-24 05:48:14.203284+00	0	1	healthy
2636	1	2026-06-24 05:49:14.20255+00	0	1	healthy
2637	5	2026-06-24 05:49:14.20255+00	0	1	healthy
2638	2	2026-06-24 05:49:14.20255+00	0	1	healthy
2639	3	2026-06-24 05:49:14.20255+00	0	1	healthy
2640	4	2026-06-24 05:49:14.20255+00	0	1	healthy
2641	1	2026-06-24 05:50:14.202511+00	0	1	healthy
2642	5	2026-06-24 05:50:14.202511+00	0	1	healthy
2643	2	2026-06-24 05:50:14.202511+00	0	1	healthy
2644	3	2026-06-24 05:50:14.202511+00	0	1	healthy
2645	4	2026-06-24 05:50:14.202511+00	0	1	healthy
2646	1	2026-06-24 05:51:14.203594+00	0	1	healthy
2647	5	2026-06-24 05:51:14.203594+00	0	1	healthy
2648	2	2026-06-24 05:51:14.203594+00	0	1	healthy
2649	3	2026-06-24 05:51:14.203594+00	0	1	healthy
2650	4	2026-06-24 05:51:14.203594+00	0	1	healthy
2651	1	2026-06-24 05:52:14.26389+00	0	1	healthy
2652	5	2026-06-24 05:52:14.26389+00	0	1	healthy
2653	2	2026-06-24 05:52:14.26389+00	0	1	healthy
2654	3	2026-06-24 05:52:14.26389+00	0	1	healthy
2655	4	2026-06-24 05:52:14.26389+00	0	1	healthy
2656	1	2026-06-24 05:53:14.202494+00	0	1	healthy
2657	5	2026-06-24 05:53:14.202494+00	0	1	healthy
2658	2	2026-06-24 05:53:14.202494+00	0	1	healthy
2659	3	2026-06-24 05:53:14.202494+00	0	1	healthy
2660	4	2026-06-24 05:53:14.202494+00	0	1	healthy
2661	1	2026-06-24 05:54:14.202667+00	0	1	healthy
2662	5	2026-06-24 05:54:14.202667+00	0	1	healthy
2663	2	2026-06-24 05:54:14.202667+00	0	1	healthy
2664	3	2026-06-24 05:54:14.202667+00	0	1	healthy
2665	4	2026-06-24 05:54:14.202667+00	0	1	healthy
2666	1	2026-06-24 05:55:14.206223+00	0	1	healthy
2667	5	2026-06-24 05:55:14.206223+00	0	1	healthy
2668	2	2026-06-24 05:55:14.206223+00	0	1	healthy
2669	3	2026-06-24 05:55:14.206223+00	0	1	healthy
2670	4	2026-06-24 05:55:14.206223+00	0	1	healthy
2671	1	2026-06-24 05:56:14.202582+00	0	1	healthy
2672	5	2026-06-24 05:56:14.202582+00	0	1	healthy
2673	2	2026-06-24 05:56:14.202582+00	0	1	healthy
2674	3	2026-06-24 05:56:14.202582+00	0	1	healthy
2675	4	2026-06-24 05:56:14.202582+00	0	1	healthy
2676	1	2026-06-24 05:57:14.203741+00	0	1	healthy
2677	5	2026-06-24 05:57:14.203741+00	0	1	healthy
2678	2	2026-06-24 05:57:14.203741+00	0	1	healthy
2679	3	2026-06-24 05:57:14.203741+00	0	1	healthy
2680	4	2026-06-24 05:57:14.203741+00	0	1	healthy
2681	1	2026-06-24 05:58:14.202854+00	0	1	healthy
2682	5	2026-06-24 05:58:14.202854+00	0	1	healthy
2683	2	2026-06-24 05:58:14.202854+00	0	1	healthy
2684	3	2026-06-24 05:58:14.202854+00	0	1	healthy
2685	4	2026-06-24 05:58:14.202854+00	0	1	healthy
2686	1	2026-06-24 05:59:14.203447+00	0	1	healthy
2687	5	2026-06-24 05:59:14.203447+00	0	1	healthy
2688	2	2026-06-24 05:59:14.203447+00	0	1	healthy
2689	3	2026-06-24 05:59:14.203447+00	0	1	healthy
2690	4	2026-06-24 05:59:14.203447+00	0	1	healthy
2691	1	2026-06-24 06:00:14.204758+00	0	1	healthy
2692	5	2026-06-24 06:00:14.204758+00	0	1	healthy
2693	2	2026-06-24 06:00:14.204758+00	0	1	healthy
2694	3	2026-06-24 06:00:14.204758+00	0	1	healthy
2695	4	2026-06-24 06:00:14.204758+00	0	1	healthy
2696	1	2026-06-24 06:01:14.204512+00	0	1	healthy
2697	5	2026-06-24 06:01:14.204512+00	0	1	healthy
2698	2	2026-06-24 06:01:14.204512+00	0	1	healthy
2699	3	2026-06-24 06:01:14.204512+00	0	1	healthy
2700	4	2026-06-24 06:01:14.204512+00	0	1	healthy
2701	1	2026-06-24 06:02:14.203499+00	0	1	healthy
2702	5	2026-06-24 06:02:14.203499+00	0	1	healthy
2703	2	2026-06-24 06:02:14.203499+00	0	1	healthy
2704	3	2026-06-24 06:02:14.203499+00	0	1	healthy
2705	4	2026-06-24 06:02:14.203499+00	0	1	healthy
2706	1	2026-06-24 06:03:14.203052+00	0	1	healthy
2707	5	2026-06-24 06:03:14.203052+00	0	1	healthy
2708	2	2026-06-24 06:03:14.203052+00	0	1	healthy
2709	3	2026-06-24 06:03:14.203052+00	0	1	healthy
2710	4	2026-06-24 06:03:14.203052+00	0	1	healthy
2711	1	2026-06-24 06:04:14.203379+00	0	1	healthy
2712	5	2026-06-24 06:04:14.203379+00	0	1	healthy
2713	2	2026-06-24 06:04:14.203379+00	0	1	healthy
2714	3	2026-06-24 06:04:14.203379+00	0	1	healthy
2715	4	2026-06-24 06:04:14.203379+00	0	1	healthy
2716	1	2026-06-24 06:05:14.206703+00	0	1	healthy
2717	5	2026-06-24 06:05:14.206703+00	0	1	healthy
2718	2	2026-06-24 06:05:14.206703+00	0	1	healthy
2719	3	2026-06-24 06:05:14.206703+00	0	1	healthy
2720	4	2026-06-24 06:05:14.206703+00	0	1	healthy
2721	1	2026-06-24 06:28:14.204063+00	0	1	healthy
2722	5	2026-06-24 06:28:14.204063+00	0	1	healthy
2723	2	2026-06-24 06:28:14.204063+00	0	1	healthy
2724	3	2026-06-24 06:28:14.204063+00	0	1	healthy
2725	4	2026-06-24 06:28:14.204063+00	0	1	healthy
2781	1	2026-06-24 06:40:14.20273+00	0	1	healthy
2782	5	2026-06-24 06:40:14.20273+00	0	1	healthy
2783	2	2026-06-24 06:40:14.20273+00	0	1	healthy
2784	3	2026-06-24 06:40:14.20273+00	0	1	healthy
2785	4	2026-06-24 06:40:14.20273+00	0	1	healthy
3481	1	2026-06-24 09:00:39.367539+00	0	1	healthy
3482	5	2026-06-24 09:00:39.367539+00	0	1	healthy
3483	2	2026-06-24 09:00:39.367539+00	0	1	healthy
3484	3	2026-06-24 09:00:39.367539+00	0	1	healthy
3485	4	2026-06-24 09:00:39.367539+00	0	1	healthy
3486	1	2026-06-24 09:01:39.180756+00	0	1	healthy
3487	5	2026-06-24 09:01:39.180756+00	0	1	healthy
3488	2	2026-06-24 09:01:39.180756+00	0	1	healthy
3489	3	2026-06-24 09:01:39.180756+00	0	1	healthy
3490	4	2026-06-24 09:01:39.180756+00	0	1	healthy
3491	1	2026-06-24 09:02:39.195826+00	0	1	healthy
3492	5	2026-06-24 09:02:39.195826+00	0	1	healthy
3493	2	2026-06-24 09:02:39.195826+00	0	1	healthy
3494	3	2026-06-24 09:02:39.195826+00	0	1	healthy
3495	4	2026-06-24 09:02:39.195826+00	0	1	healthy
3496	1	2026-06-24 09:03:39.181766+00	0	1	healthy
3497	5	2026-06-24 09:03:39.181766+00	0	1	healthy
3498	2	2026-06-24 09:03:39.181766+00	0	1	healthy
3499	3	2026-06-24 09:03:39.181766+00	0	1	healthy
3500	4	2026-06-24 09:03:39.181766+00	0	1	healthy
3501	1	2026-06-24 09:04:39.181193+00	0	1	healthy
3502	5	2026-06-24 09:04:39.181193+00	0	1	healthy
3503	2	2026-06-24 09:04:39.181193+00	0	1	healthy
3504	3	2026-06-24 09:04:39.181193+00	0	1	healthy
3505	4	2026-06-24 09:04:39.181193+00	0	1	healthy
3506	1	2026-06-24 09:05:39.186246+00	0	1	healthy
3507	5	2026-06-24 09:05:39.186246+00	0	1	healthy
3508	2	2026-06-24 09:05:39.186246+00	0	1	healthy
3509	3	2026-06-24 09:05:39.186246+00	0	1	healthy
3510	4	2026-06-24 09:05:39.186246+00	0	1	healthy
3511	1	2026-06-24 09:06:39.190851+00	0	1	healthy
3512	5	2026-06-24 09:06:39.190851+00	0	1	healthy
3513	2	2026-06-24 09:06:39.190851+00	0	1	healthy
3514	3	2026-06-24 09:06:39.190851+00	0	1	healthy
3515	4	2026-06-24 09:06:39.190851+00	0	1	healthy
3516	1	2026-06-24 09:07:39.179917+00	0	1	healthy
3517	5	2026-06-24 09:07:39.179917+00	0	1	healthy
3518	2	2026-06-24 09:07:39.179917+00	0	1	healthy
3519	3	2026-06-24 09:07:39.179917+00	0	1	healthy
3520	4	2026-06-24 09:07:39.179917+00	0	1	healthy
3521	1	2026-06-24 09:08:39.187594+00	0	1	healthy
3522	5	2026-06-24 09:08:39.187594+00	0	1	healthy
3523	2	2026-06-24 09:08:39.187594+00	0	1	healthy
3524	3	2026-06-24 09:08:39.187594+00	0	1	healthy
3525	4	2026-06-24 09:08:39.187594+00	0	1	healthy
3526	1	2026-06-24 09:09:39.178844+00	0	1	healthy
3527	5	2026-06-24 09:09:39.178844+00	0	1	healthy
3528	2	2026-06-24 09:09:39.178844+00	0	1	healthy
3529	3	2026-06-24 09:09:39.178844+00	0	1	healthy
3530	4	2026-06-24 09:09:39.178844+00	0	1	healthy
3531	1	2026-06-24 09:10:39.184195+00	0	1	healthy
3532	5	2026-06-24 09:10:39.184195+00	0	1	healthy
3533	2	2026-06-24 09:10:39.184195+00	0	1	healthy
3534	3	2026-06-24 09:10:39.184195+00	0	1	healthy
3535	4	2026-06-24 09:10:39.184195+00	0	1	healthy
3536	1	2026-06-24 09:11:39.18178+00	0	1	healthy
3537	5	2026-06-24 09:11:39.18178+00	0	1	healthy
3538	2	2026-06-24 09:11:39.18178+00	0	1	healthy
3539	3	2026-06-24 09:11:39.18178+00	0	1	healthy
3540	4	2026-06-24 09:11:39.18178+00	0	1	healthy
3541	1	2026-06-24 09:12:39.188803+00	0	1	healthy
3542	5	2026-06-24 09:12:39.188803+00	0	1	healthy
3543	2	2026-06-24 09:12:39.188803+00	0	1	healthy
3544	3	2026-06-24 09:12:39.188803+00	0	1	healthy
3545	4	2026-06-24 09:12:39.188803+00	0	1	healthy
3546	1	2026-06-24 09:13:39.183568+00	0	1	healthy
3547	5	2026-06-24 09:13:39.183568+00	0	1	healthy
3548	2	2026-06-24 09:13:39.183568+00	0	1	healthy
3549	3	2026-06-24 09:13:39.183568+00	0	1	healthy
3550	4	2026-06-24 09:13:39.183568+00	0	1	healthy
3551	1	2026-06-24 09:14:39.183277+00	0	1	healthy
3552	5	2026-06-24 09:14:39.183277+00	0	1	healthy
3553	2	2026-06-24 09:14:39.183277+00	0	1	healthy
3554	3	2026-06-24 09:14:39.183277+00	0	1	healthy
3555	4	2026-06-24 09:14:39.183277+00	0	1	healthy
3556	1	2026-06-24 09:15:39.181228+00	0	1	healthy
3557	5	2026-06-24 09:15:39.181228+00	0	1	healthy
3558	2	2026-06-24 09:15:39.181228+00	0	1	healthy
3559	3	2026-06-24 09:15:39.181228+00	0	1	healthy
3560	4	2026-06-24 09:15:39.181228+00	0	1	healthy
3561	1	2026-06-24 09:16:39.179731+00	0	1	healthy
3562	5	2026-06-24 09:16:39.179731+00	0	1	healthy
3563	2	2026-06-24 09:16:39.179731+00	0	1	healthy
3564	3	2026-06-24 09:16:39.179731+00	0	1	healthy
3565	4	2026-06-24 09:16:39.179731+00	0	1	healthy
3566	1	2026-06-24 09:17:39.415916+00	0	1	healthy
3567	5	2026-06-24 09:17:39.415916+00	0	1	healthy
3568	2	2026-06-24 09:17:39.415916+00	0	1	healthy
3569	3	2026-06-24 09:17:39.415916+00	0	1	healthy
3570	4	2026-06-24 09:17:39.415916+00	0	1	healthy
3571	1	2026-06-24 09:18:39.180412+00	0	1	healthy
3572	5	2026-06-24 09:18:39.180412+00	0	1	healthy
3573	2	2026-06-24 09:18:39.180412+00	0	1	healthy
3574	3	2026-06-24 09:18:39.180412+00	0	1	healthy
3575	4	2026-06-24 09:18:39.180412+00	0	1	healthy
3576	1	2026-06-24 09:19:39.17974+00	0	1	healthy
3577	5	2026-06-24 09:19:39.17974+00	0	1	healthy
3578	2	2026-06-24 09:19:39.17974+00	0	1	healthy
3579	3	2026-06-24 09:19:39.17974+00	0	1	healthy
3580	4	2026-06-24 09:19:39.17974+00	0	1	healthy
3581	1	2026-06-24 09:20:39.180417+00	0	1	healthy
3582	5	2026-06-24 09:20:39.180417+00	0	1	healthy
3583	2	2026-06-24 09:20:39.180417+00	0	1	healthy
3584	3	2026-06-24 09:20:39.180417+00	0	1	healthy
3585	4	2026-06-24 09:20:39.180417+00	0	1	healthy
3586	1	2026-06-24 09:21:39.180657+00	0	1	healthy
3587	5	2026-06-24 09:21:39.180657+00	0	1	healthy
3588	2	2026-06-24 09:21:39.180657+00	0	1	healthy
3589	3	2026-06-24 09:21:39.180657+00	0	1	healthy
3590	4	2026-06-24 09:21:39.180657+00	0	1	healthy
3591	1	2026-06-24 09:22:39.180951+00	0	1	healthy
3592	5	2026-06-24 09:22:39.180951+00	0	1	healthy
3593	2	2026-06-24 09:22:39.180951+00	0	1	healthy
3594	3	2026-06-24 09:22:39.180951+00	0	1	healthy
3595	4	2026-06-24 09:22:39.180951+00	0	1	healthy
3596	1	2026-06-24 09:23:39.180112+00	0	1	healthy
3597	5	2026-06-24 09:23:39.180112+00	0	1	healthy
3598	2	2026-06-24 09:23:39.180112+00	0	1	healthy
3599	3	2026-06-24 09:23:39.180112+00	0	1	healthy
3600	4	2026-06-24 09:23:39.180112+00	0	1	healthy
3601	1	2026-06-24 09:24:39.181168+00	0	1	healthy
3602	5	2026-06-24 09:24:39.181168+00	0	1	healthy
3603	2	2026-06-24 09:24:39.181168+00	0	1	healthy
3604	3	2026-06-24 09:24:39.181168+00	0	1	healthy
3605	4	2026-06-24 09:24:39.181168+00	0	1	healthy
3636	1	2026-06-24 09:31:39.181541+00	0	1	healthy
3637	5	2026-06-24 09:31:39.181541+00	0	1	healthy
3638	2	2026-06-24 09:31:39.181541+00	0	1	healthy
3639	3	2026-06-24 09:31:39.181541+00	0	1	healthy
3640	4	2026-06-24 09:31:39.181541+00	0	1	healthy
6364	1	2026-06-25 10:13:43.26665+00	0	1	healthy
6365	5	2026-06-25 10:13:43.26665+00	0	1	healthy
6366	2	2026-06-25 10:13:43.26665+00	0	1	healthy
6367	3	2026-06-25 10:13:43.26665+00	0	1	healthy
6368	4	2026-06-25 10:13:43.26665+00	0	1	healthy
6379	1	2026-06-25 10:16:43.26553+00	0	1	healthy
6380	5	2026-06-25 10:16:43.26553+00	0	1	healthy
6381	2	2026-06-25 10:16:43.26553+00	0	1	healthy
6382	3	2026-06-25 10:16:43.26553+00	0	1	healthy
6383	4	2026-06-25 10:16:43.26553+00	0	1	healthy
6404	1	2026-06-25 10:21:43.264331+00	0	1	healthy
6405	5	2026-06-25 10:21:43.264331+00	0	1	healthy
6406	2	2026-06-25 10:21:43.264331+00	0	1	healthy
6407	3	2026-06-25 10:21:43.264331+00	0	1	healthy
6408	4	2026-06-25 10:21:43.264331+00	0	1	healthy
7474	1	2026-06-26 07:46:43.85493+00	0	1	healthy
7475	5	2026-06-26 07:46:43.85493+00	0	1	healthy
7476	2	2026-06-26 07:46:43.85493+00	0	1	healthy
7477	3	2026-06-26 07:46:43.85493+00	0	1	healthy
7478	4	2026-06-26 07:46:43.85493+00	0	1	healthy
7479	1	2026-06-26 08:01:43.806361+00	0	1	healthy
7480	5	2026-06-26 08:01:43.806361+00	0	1	healthy
7481	2	2026-06-26 08:01:43.806361+00	0	1	healthy
7482	3	2026-06-26 08:01:43.806361+00	0	1	healthy
7483	4	2026-06-26 08:01:43.806361+00	0	1	healthy
3606	1	2026-06-24 09:25:39.180316+00	0	1	healthy
3607	5	2026-06-24 09:25:39.180316+00	0	1	healthy
3608	2	2026-06-24 09:25:39.180316+00	0	1	healthy
3609	3	2026-06-24 09:25:39.180316+00	0	1	healthy
3610	4	2026-06-24 09:25:39.180316+00	0	1	healthy
3641	1	2026-06-24 09:32:39.215149+00	0	1	healthy
3642	5	2026-06-24 09:32:39.215149+00	0	1	healthy
3643	2	2026-06-24 09:32:39.215149+00	0	1	healthy
3644	3	2026-06-24 09:32:39.215149+00	0	1	healthy
3645	4	2026-06-24 09:32:39.215149+00	0	1	healthy
3646	1	2026-06-24 09:33:39.181813+00	0	1	healthy
3647	5	2026-06-24 09:33:39.181813+00	0	1	healthy
3648	2	2026-06-24 09:33:39.181813+00	0	1	healthy
3649	3	2026-06-24 09:33:39.181813+00	0	1	healthy
3650	4	2026-06-24 09:33:39.181813+00	0	1	healthy
6369	1	2026-06-25 10:14:43.266866+00	0	1	healthy
6370	5	2026-06-25 10:14:43.266866+00	0	1	healthy
6371	2	2026-06-25 10:14:43.266866+00	0	1	healthy
6372	3	2026-06-25 10:14:43.266866+00	0	1	healthy
6373	4	2026-06-25 10:14:43.266866+00	0	1	healthy
6389	1	2026-06-25 10:18:43.26495+00	0	1	healthy
6390	5	2026-06-25 10:18:43.26495+00	0	1	healthy
6391	2	2026-06-25 10:18:43.26495+00	0	1	healthy
6392	3	2026-06-25 10:18:43.26495+00	0	1	healthy
6393	4	2026-06-25 10:18:43.26495+00	0	1	healthy
6399	1	2026-06-25 10:20:43.267857+00	0	1	healthy
6400	5	2026-06-25 10:20:43.267857+00	0	1	healthy
6401	2	2026-06-25 10:20:43.267857+00	0	1	healthy
6402	3	2026-06-25 10:20:43.267857+00	0	1	healthy
6403	4	2026-06-25 10:20:43.267857+00	0	1	healthy
7489	1	2026-06-26 08:36:57.239184+00	0	1	healthy
7490	5	2026-06-26 08:36:57.239184+00	0	1	healthy
7491	2	2026-06-26 08:36:57.239184+00	0	1	healthy
7492	3	2026-06-26 08:36:57.239184+00	0	1	healthy
7493	4	2026-06-26 08:36:57.239184+00	0	1	healthy
7494	1	2026-06-26 08:51:57.233412+00	0	1	healthy
7495	5	2026-06-26 08:51:57.233412+00	0	1	healthy
7496	2	2026-06-26 08:51:57.233412+00	0	1	healthy
7497	3	2026-06-26 08:51:57.233412+00	0	1	healthy
7498	4	2026-06-26 08:51:57.233412+00	0	1	healthy
3611	1	2026-06-24 09:26:39.17907+00	0	1	healthy
3612	5	2026-06-24 09:26:39.17907+00	0	1	healthy
3613	2	2026-06-24 09:26:39.17907+00	0	1	healthy
3614	3	2026-06-24 09:26:39.17907+00	0	1	healthy
3615	4	2026-06-24 09:26:39.17907+00	0	1	healthy
3621	1	2026-06-24 09:28:39.179663+00	0	1	healthy
3622	5	2026-06-24 09:28:39.179663+00	0	1	healthy
3623	2	2026-06-24 09:28:39.179663+00	0	1	healthy
3624	3	2026-06-24 09:28:39.179663+00	0	1	healthy
3625	4	2026-06-24 09:28:39.179663+00	0	1	healthy
6374	1	2026-06-25 10:15:43.264819+00	0	1	healthy
6375	5	2026-06-25 10:15:43.264819+00	0	1	healthy
6376	2	2026-06-25 10:15:43.264819+00	0	1	healthy
6377	3	2026-06-25 10:15:43.264819+00	0	1	healthy
6378	4	2026-06-25 10:15:43.264819+00	0	1	healthy
6394	1	2026-06-25 10:19:43.267525+00	0	1	healthy
6395	5	2026-06-25 10:19:43.267525+00	0	1	healthy
6396	2	2026-06-25 10:19:43.267525+00	0	1	healthy
6397	3	2026-06-25 10:19:43.267525+00	0	1	healthy
6398	4	2026-06-25 10:19:43.267525+00	0	1	healthy
6414	1	2026-06-25 10:23:43.265772+00	0	1	healthy
6415	5	2026-06-25 10:23:43.265772+00	0	1	healthy
6416	2	2026-06-25 10:23:43.265772+00	0	1	healthy
6417	3	2026-06-25 10:23:43.265772+00	0	1	healthy
6418	4	2026-06-25 10:23:43.265772+00	0	1	healthy
7499	1	2026-06-26 09:06:57.232326+00	0	1	healthy
7500	5	2026-06-26 09:06:57.232326+00	0	1	healthy
7501	2	2026-06-26 09:06:57.232326+00	0	1	healthy
7502	3	2026-06-26 09:06:57.232326+00	0	1	healthy
7503	4	2026-06-26 09:06:57.232326+00	0	1	healthy
7504	1	2026-06-26 09:21:57.240522+00	0	1	healthy
7505	5	2026-06-26 09:21:57.240522+00	0	1	healthy
7506	2	2026-06-26 09:21:57.240522+00	0	1	healthy
7507	3	2026-06-26 09:21:57.240522+00	0	1	healthy
7508	4	2026-06-26 09:21:57.240522+00	0	1	healthy
3616	1	2026-06-24 09:27:39.183267+00	0	1	healthy
3617	5	2026-06-24 09:27:39.183267+00	0	1	healthy
3618	2	2026-06-24 09:27:39.183267+00	0	1	healthy
3619	3	2026-06-24 09:27:39.183267+00	0	1	healthy
3620	4	2026-06-24 09:27:39.183267+00	0	1	healthy
3631	1	2026-06-24 09:30:39.181067+00	0	1	healthy
3632	5	2026-06-24 09:30:39.181067+00	0	1	healthy
3633	2	2026-06-24 09:30:39.181067+00	0	1	healthy
3634	3	2026-06-24 09:30:39.181067+00	0	1	healthy
3635	4	2026-06-24 09:30:39.181067+00	0	1	healthy
6384	1	2026-06-25 10:17:43.265066+00	0	1	healthy
6385	5	2026-06-25 10:17:43.265066+00	0	1	healthy
6386	2	2026-06-25 10:17:43.265066+00	0	1	healthy
6387	3	2026-06-25 10:17:43.265066+00	0	1	healthy
6388	4	2026-06-25 10:17:43.265066+00	0	1	healthy
6419	1	2026-06-25 10:24:43.266115+00	0	1	healthy
6420	5	2026-06-25 10:24:43.266115+00	0	1	healthy
6421	2	2026-06-25 10:24:43.266115+00	0	1	healthy
6422	3	2026-06-25 10:24:43.266115+00	0	1	healthy
6423	4	2026-06-25 10:24:43.266115+00	0	1	healthy
7509	1	2026-06-26 09:36:57.232357+00	0	1	healthy
7510	5	2026-06-26 09:36:57.232357+00	0	1	healthy
7511	2	2026-06-26 09:36:57.232357+00	0	1	healthy
7512	3	2026-06-26 09:36:57.232357+00	0	1	healthy
7513	4	2026-06-26 09:36:57.232357+00	0	1	healthy
7514	1	2026-06-26 09:51:57.235349+00	0	1	healthy
7515	5	2026-06-26 09:51:57.235349+00	0	1	healthy
7516	2	2026-06-26 09:51:57.235349+00	0	1	healthy
7517	3	2026-06-26 09:51:57.235349+00	0	1	healthy
7518	4	2026-06-26 09:51:57.235349+00	0	1	healthy
3626	1	2026-06-24 09:29:39.179831+00	0	1	healthy
3627	5	2026-06-24 09:29:39.179831+00	0	1	healthy
3628	2	2026-06-24 09:29:39.179831+00	0	1	healthy
3629	3	2026-06-24 09:29:39.179831+00	0	1	healthy
3630	4	2026-06-24 09:29:39.179831+00	0	1	healthy
3651	1	2026-06-24 09:34:39.180701+00	0	1	healthy
3652	5	2026-06-24 09:34:39.180701+00	0	1	healthy
3653	2	2026-06-24 09:34:39.180701+00	0	1	healthy
3654	3	2026-06-24 09:34:39.180701+00	0	1	healthy
3655	4	2026-06-24 09:34:39.180701+00	0	1	healthy
3656	1	2026-06-24 09:35:39.181105+00	0	1	healthy
3657	5	2026-06-24 09:35:39.181105+00	0	1	healthy
3658	2	2026-06-24 09:35:39.181105+00	0	1	healthy
3659	3	2026-06-24 09:35:39.181105+00	0	1	healthy
3660	4	2026-06-24 09:35:39.181105+00	0	1	healthy
3661	1	2026-06-24 09:36:39.179595+00	0	1	healthy
3662	5	2026-06-24 09:36:39.179595+00	0	1	healthy
3663	2	2026-06-24 09:36:39.179595+00	0	1	healthy
3664	3	2026-06-24 09:36:39.179595+00	0	1	healthy
3665	4	2026-06-24 09:36:39.179595+00	0	1	healthy
3666	1	2026-06-24 09:37:39.184749+00	0	1	healthy
3667	5	2026-06-24 09:37:39.184749+00	0	1	healthy
3668	2	2026-06-24 09:37:39.184749+00	0	1	healthy
3669	3	2026-06-24 09:37:39.184749+00	0	1	healthy
3670	4	2026-06-24 09:37:39.184749+00	0	1	healthy
3671	1	2026-06-24 09:38:39.188168+00	0	1	healthy
3672	5	2026-06-24 09:38:39.188168+00	0	1	healthy
3673	2	2026-06-24 09:38:39.188168+00	0	1	healthy
3674	3	2026-06-24 09:38:39.188168+00	0	1	healthy
3675	4	2026-06-24 09:38:39.188168+00	0	1	healthy
3676	1	2026-06-24 09:39:39.180283+00	0	1	healthy
3677	5	2026-06-24 09:39:39.180283+00	0	1	healthy
3678	2	2026-06-24 09:39:39.180283+00	0	1	healthy
3679	3	2026-06-24 09:39:39.180283+00	0	1	healthy
3680	4	2026-06-24 09:39:39.180283+00	0	1	healthy
3681	1	2026-06-24 09:40:39.179489+00	0	1	healthy
3682	5	2026-06-24 09:40:39.179489+00	0	1	healthy
3683	2	2026-06-24 09:40:39.179489+00	0	1	healthy
3684	3	2026-06-24 09:40:39.179489+00	0	1	healthy
3685	4	2026-06-24 09:40:39.179489+00	0	1	healthy
3686	1	2026-06-24 09:41:39.199275+00	0	1	healthy
3687	5	2026-06-24 09:41:39.199275+00	0	1	healthy
3688	2	2026-06-24 09:41:39.199275+00	0	1	healthy
3689	3	2026-06-24 09:41:39.199275+00	0	1	healthy
3690	4	2026-06-24 09:41:39.199275+00	0	1	healthy
3691	1	2026-06-24 09:42:39.182848+00	0	1	healthy
3692	5	2026-06-24 09:42:39.182848+00	0	1	healthy
3693	2	2026-06-24 09:42:39.182848+00	0	1	healthy
3694	3	2026-06-24 09:42:39.182848+00	0	1	healthy
3695	4	2026-06-24 09:42:39.182848+00	0	1	healthy
3696	1	2026-06-24 09:43:39.180439+00	0	1	healthy
3697	5	2026-06-24 09:43:39.180439+00	0	1	healthy
3698	2	2026-06-24 09:43:39.180439+00	0	1	healthy
3699	3	2026-06-24 09:43:39.180439+00	0	1	healthy
3700	4	2026-06-24 09:43:39.180439+00	0	1	healthy
3701	1	2026-06-24 09:44:39.179404+00	0	1	healthy
3702	5	2026-06-24 09:44:39.179404+00	0	1	healthy
3703	2	2026-06-24 09:44:39.179404+00	0	1	healthy
3704	3	2026-06-24 09:44:39.179404+00	0	1	healthy
3705	4	2026-06-24 09:44:39.179404+00	0	1	healthy
3706	1	2026-06-24 09:45:39.180915+00	0	1	healthy
3707	5	2026-06-24 09:45:39.180915+00	0	1	healthy
3708	2	2026-06-24 09:45:39.180915+00	0	1	healthy
3709	3	2026-06-24 09:45:39.180915+00	0	1	healthy
3710	4	2026-06-24 09:45:39.180915+00	0	1	healthy
3711	1	2026-06-24 09:46:39.180826+00	0	1	healthy
3712	5	2026-06-24 09:46:39.180826+00	0	1	healthy
3713	2	2026-06-24 09:46:39.180826+00	0	1	healthy
3714	3	2026-06-24 09:46:39.180826+00	0	1	healthy
3715	4	2026-06-24 09:46:39.180826+00	0	1	healthy
3716	1	2026-06-24 09:47:39.256062+00	0	1	healthy
3717	5	2026-06-24 09:47:39.256062+00	0	1	healthy
3718	2	2026-06-24 09:47:39.256062+00	0	1	healthy
3719	3	2026-06-24 09:47:39.256062+00	0	1	healthy
3720	4	2026-06-24 09:47:39.256062+00	0	1	healthy
3721	1	2026-06-24 09:48:39.180218+00	0	1	healthy
3722	5	2026-06-24 09:48:39.180218+00	0	1	healthy
3723	2	2026-06-24 09:48:39.180218+00	0	1	healthy
3724	3	2026-06-24 09:48:39.180218+00	0	1	healthy
3725	4	2026-06-24 09:48:39.180218+00	0	1	healthy
3726	1	2026-06-24 09:49:39.180342+00	0	1	healthy
3727	5	2026-06-24 09:49:39.180342+00	0	1	healthy
3728	2	2026-06-24 09:49:39.180342+00	0	1	healthy
3729	3	2026-06-24 09:49:39.180342+00	0	1	healthy
3730	4	2026-06-24 09:49:39.180342+00	0	1	healthy
3731	1	2026-06-24 09:50:39.180827+00	0	1	healthy
3732	5	2026-06-24 09:50:39.180827+00	0	1	healthy
3733	2	2026-06-24 09:50:39.180827+00	0	1	healthy
3734	3	2026-06-24 09:50:39.180827+00	0	1	healthy
3735	4	2026-06-24 09:50:39.180827+00	0	1	healthy
3736	1	2026-06-24 09:51:39.180208+00	0	1	healthy
3737	5	2026-06-24 09:51:39.180208+00	0	1	healthy
3738	2	2026-06-24 09:51:39.180208+00	0	1	healthy
3739	3	2026-06-24 09:51:39.180208+00	0	1	healthy
3740	4	2026-06-24 09:51:39.180208+00	0	1	healthy
3741	1	2026-06-24 09:52:39.181441+00	0	1	healthy
3742	5	2026-06-24 09:52:39.181441+00	0	1	healthy
3743	2	2026-06-24 09:52:39.181441+00	0	1	healthy
3744	3	2026-06-24 09:52:39.181441+00	0	1	healthy
3745	4	2026-06-24 09:52:39.181441+00	0	1	healthy
3746	1	2026-06-24 09:53:39.181404+00	0	1	healthy
3747	5	2026-06-24 09:53:39.181404+00	0	1	healthy
3748	2	2026-06-24 09:53:39.181404+00	0	1	healthy
3749	3	2026-06-24 09:53:39.181404+00	0	1	healthy
3750	4	2026-06-24 09:53:39.181404+00	0	1	healthy
3751	1	2026-06-24 09:54:39.179308+00	0	1	healthy
3752	5	2026-06-24 09:54:39.179308+00	0	1	healthy
3753	2	2026-06-24 09:54:39.179308+00	0	1	healthy
3754	3	2026-06-24 09:54:39.179308+00	0	1	healthy
3755	4	2026-06-24 09:54:39.179308+00	0	1	healthy
3756	1	2026-06-24 09:55:39.181693+00	0	1	healthy
3757	5	2026-06-24 09:55:39.181693+00	0	1	healthy
3758	2	2026-06-24 09:55:39.181693+00	0	1	healthy
3759	3	2026-06-24 09:55:39.181693+00	0	1	healthy
3760	4	2026-06-24 09:55:39.181693+00	0	1	healthy
3761	1	2026-06-24 09:56:39.182159+00	0	1	healthy
3762	5	2026-06-24 09:56:39.182159+00	0	1	healthy
3763	2	2026-06-24 09:56:39.182159+00	0	1	healthy
3764	3	2026-06-24 09:56:39.182159+00	0	1	healthy
3765	4	2026-06-24 09:56:39.182159+00	0	1	healthy
3766	1	2026-06-24 09:57:39.196293+00	0	1	healthy
3767	5	2026-06-24 09:57:39.196293+00	0	1	healthy
3768	2	2026-06-24 09:57:39.196293+00	0	1	healthy
3769	3	2026-06-24 09:57:39.196293+00	0	1	healthy
3770	4	2026-06-24 09:57:39.196293+00	0	1	healthy
6409	1	2026-06-25 10:22:43.265428+00	0	1	healthy
6410	5	2026-06-25 10:22:43.265428+00	0	1	healthy
6411	2	2026-06-25 10:22:43.265428+00	0	1	healthy
6412	3	2026-06-25 10:22:43.265428+00	0	1	healthy
6413	4	2026-06-25 10:22:43.265428+00	0	1	healthy
6424	1	2026-06-25 10:25:43.265243+00	0	1	healthy
6425	5	2026-06-25 10:25:43.265243+00	0	1	healthy
6426	2	2026-06-25 10:25:43.265243+00	0	1	healthy
6427	3	2026-06-25 10:25:43.265243+00	0	1	healthy
6428	4	2026-06-25 10:25:43.265243+00	0	1	healthy
7519	1	2026-06-26 10:06:57.232594+00	0	1	healthy
7520	5	2026-06-26 10:06:57.232594+00	0	1	healthy
7521	2	2026-06-26 10:06:57.232594+00	0	1	healthy
7522	3	2026-06-26 10:06:57.232594+00	0	1	healthy
7523	4	2026-06-26 10:06:57.232594+00	0	1	healthy
7524	1	2026-06-26 10:21:57.232963+00	0	1	healthy
7525	5	2026-06-26 10:21:57.232963+00	0	1	healthy
7526	2	2026-06-26 10:21:57.232963+00	0	1	healthy
7527	3	2026-06-26 10:21:57.232963+00	0	1	healthy
7528	4	2026-06-26 10:21:57.232963+00	0	1	healthy
3771	1	2026-06-24 09:58:39.214221+00	0	1	healthy
3772	5	2026-06-24 09:58:39.214221+00	0	1	healthy
3773	2	2026-06-24 09:58:39.214221+00	0	1	healthy
3774	3	2026-06-24 09:58:39.214221+00	0	1	healthy
3775	4	2026-06-24 09:58:39.214221+00	0	1	healthy
3776	1	2026-06-24 09:59:39.178562+00	0	1	healthy
3777	5	2026-06-24 09:59:39.178562+00	0	1	healthy
3778	2	2026-06-24 09:59:39.178562+00	0	1	healthy
3779	3	2026-06-24 09:59:39.178562+00	0	1	healthy
3780	4	2026-06-24 09:59:39.178562+00	0	1	healthy
3781	1	2026-06-24 10:00:39.181728+00	0	1	healthy
3782	5	2026-06-24 10:00:39.181728+00	0	1	healthy
3783	2	2026-06-24 10:00:39.181728+00	0	1	healthy
3784	3	2026-06-24 10:00:39.181728+00	0	1	healthy
3785	4	2026-06-24 10:00:39.181728+00	0	1	healthy
6429	1	2026-06-25 10:26:43.264855+00	0	1	healthy
6430	5	2026-06-25 10:26:43.264855+00	0	1	healthy
6431	2	2026-06-25 10:26:43.264855+00	0	1	healthy
6432	3	2026-06-25 10:26:43.264855+00	0	1	healthy
6433	4	2026-06-25 10:26:43.264855+00	0	1	healthy
6459	1	2026-06-25 10:32:43.322307+00	0	1	healthy
6460	5	2026-06-25 10:32:43.322307+00	0	1	healthy
6461	2	2026-06-25 10:32:43.322307+00	0	1	healthy
6462	3	2026-06-25 10:32:43.322307+00	0	1	healthy
6463	4	2026-06-25 10:32:43.322307+00	0	1	healthy
6474	1	2026-06-25 10:35:43.266517+00	0	1	healthy
6475	5	2026-06-25 10:35:43.266517+00	0	1	healthy
6476	2	2026-06-25 10:35:43.266517+00	0	1	healthy
6477	3	2026-06-25 10:35:43.266517+00	0	1	healthy
6478	4	2026-06-25 10:35:43.266517+00	0	1	healthy
6504	1	2026-06-25 10:41:43.278409+00	0	1	healthy
6505	5	2026-06-25 10:41:43.278409+00	0	1	healthy
6506	2	2026-06-25 10:41:43.278409+00	0	1	healthy
6507	3	2026-06-25 10:41:43.278409+00	0	1	healthy
6508	4	2026-06-25 10:41:43.278409+00	0	1	healthy
6554	1	2026-06-25 10:51:43.266519+00	0	1	healthy
6555	5	2026-06-25 10:51:43.266519+00	0	1	healthy
6556	2	2026-06-25 10:51:43.266519+00	0	1	healthy
6557	3	2026-06-25 10:51:43.266519+00	0	1	healthy
6558	4	2026-06-25 10:51:43.266519+00	0	1	healthy
6604	1	2026-06-25 11:01:43.264773+00	0	1	healthy
6605	5	2026-06-25 11:01:43.264773+00	0	1	healthy
6606	2	2026-06-25 11:01:43.264773+00	0	1	healthy
6607	3	2026-06-25 11:01:43.264773+00	0	1	healthy
6608	4	2026-06-25 11:01:43.264773+00	0	1	healthy
6659	1	2026-06-25 11:12:43.265981+00	0	1	healthy
6660	5	2026-06-25 11:12:43.265981+00	0	1	healthy
6661	2	2026-06-25 11:12:43.265981+00	0	1	healthy
6662	3	2026-06-25 11:12:43.265981+00	0	1	healthy
6663	4	2026-06-25 11:12:43.265981+00	0	1	healthy
6674	1	2026-06-25 11:15:43.281852+00	0	1	healthy
6675	5	2026-06-25 11:15:43.281852+00	0	1	healthy
6676	2	2026-06-25 11:15:43.281852+00	0	1	healthy
6677	3	2026-06-25 11:15:43.281852+00	0	1	healthy
6678	4	2026-06-25 11:15:43.281852+00	0	1	healthy
6699	1	2026-06-25 13:47:43.26527+00	0	1	healthy
6700	5	2026-06-25 13:47:43.26527+00	0	1	healthy
6701	2	2026-06-25 13:47:43.26527+00	0	1	healthy
6702	3	2026-06-25 13:47:43.26527+00	0	1	healthy
6703	4	2026-06-25 13:47:43.26527+00	0	1	healthy
6714	1	2026-06-25 15:37:43.267671+00	0	1	healthy
6715	5	2026-06-25 15:37:43.267671+00	0	1	healthy
6716	2	2026-06-25 15:37:43.267671+00	0	1	healthy
6717	3	2026-06-25 15:37:43.267671+00	0	1	healthy
6718	4	2026-06-25 15:37:43.267671+00	0	1	healthy
6744	1	2026-06-25 17:22:43.265984+00	0	1	healthy
6745	5	2026-06-25 17:22:43.265984+00	0	1	healthy
6746	2	2026-06-25 17:22:43.265984+00	0	1	healthy
6747	3	2026-06-25 17:22:43.265984+00	0	1	healthy
6748	4	2026-06-25 17:22:43.265984+00	0	1	healthy
6759	1	2026-06-25 17:25:43.265893+00	0	1	healthy
6760	5	2026-06-25 17:25:43.265893+00	0	1	healthy
6761	2	2026-06-25 17:25:43.265893+00	0	1	healthy
6762	3	2026-06-25 17:25:43.265893+00	0	1	healthy
6763	4	2026-06-25 17:25:43.265893+00	0	1	healthy
6779	1	2026-06-25 17:29:43.26739+00	0	1	healthy
6780	5	2026-06-25 17:29:43.26739+00	0	1	healthy
6781	2	2026-06-25 17:29:43.26739+00	0	1	healthy
6782	3	2026-06-25 17:29:43.26739+00	0	1	healthy
6783	4	2026-06-25 17:29:43.26739+00	0	1	healthy
6799	1	2026-06-25 17:33:43.320554+00	0	1	healthy
6800	5	2026-06-25 17:33:43.320554+00	0	1	healthy
6801	2	2026-06-25 17:33:43.320554+00	0	1	healthy
6802	3	2026-06-25 17:33:43.320554+00	0	1	healthy
6803	4	2026-06-25 17:33:43.320554+00	0	1	healthy
6814	1	2026-06-25 17:36:43.265311+00	0	1	healthy
6815	5	2026-06-25 17:36:43.265311+00	0	1	healthy
6816	2	2026-06-25 17:36:43.265311+00	0	1	healthy
6817	3	2026-06-25 17:36:43.265311+00	0	1	healthy
6818	4	2026-06-25 17:36:43.265311+00	0	1	healthy
6829	1	2026-06-25 17:39:43.268092+00	0	1	healthy
6830	5	2026-06-25 17:39:43.268092+00	0	1	healthy
6831	2	2026-06-25 17:39:43.268092+00	0	1	healthy
6832	3	2026-06-25 17:39:43.268092+00	0	1	healthy
6833	4	2026-06-25 17:39:43.268092+00	0	1	healthy
6849	1	2026-06-25 18:13:43.26593+00	0	1	healthy
6850	5	2026-06-25 18:13:43.26593+00	0	1	healthy
6851	2	2026-06-25 18:13:43.26593+00	0	1	healthy
6852	3	2026-06-25 18:13:43.26593+00	0	1	healthy
6853	4	2026-06-25 18:13:43.26593+00	0	1	healthy
6864	1	2026-06-25 18:16:43.266232+00	0	1	healthy
6865	5	2026-06-25 18:16:43.266232+00	0	1	healthy
6866	2	2026-06-25 18:16:43.266232+00	0	1	healthy
6867	3	2026-06-25 18:16:43.266232+00	0	1	healthy
6868	4	2026-06-25 18:16:43.266232+00	0	1	healthy
6894	1	2026-06-25 18:22:43.265153+00	0	1	healthy
6895	5	2026-06-25 18:22:43.265153+00	0	1	healthy
6896	2	2026-06-25 18:22:43.265153+00	0	1	healthy
6897	3	2026-06-25 18:22:43.265153+00	0	1	healthy
6898	4	2026-06-25 18:22:43.265153+00	0	1	healthy
6909	1	2026-06-25 18:25:43.2644+00	0	1	healthy
6910	5	2026-06-25 18:25:43.2644+00	0	1	healthy
6911	2	2026-06-25 18:25:43.2644+00	0	1	healthy
6912	3	2026-06-25 18:25:43.2644+00	0	1	healthy
6913	4	2026-06-25 18:25:43.2644+00	0	1	healthy
6939	1	2026-06-25 22:36:43.268517+00	0	1	healthy
6940	5	2026-06-25 22:36:43.268517+00	0	1	healthy
6941	2	2026-06-25 22:36:43.268517+00	0	1	healthy
6942	3	2026-06-25 22:36:43.268517+00	0	1	healthy
6943	4	2026-06-25 22:36:43.268517+00	0	1	healthy
3786	1	2026-06-24 10:01:39.207407+00	0	1	healthy
3787	5	2026-06-24 10:01:39.207407+00	0	1	healthy
3788	2	2026-06-24 10:01:39.207407+00	0	1	healthy
3789	3	2026-06-24 10:01:39.207407+00	0	1	healthy
3790	4	2026-06-24 10:01:39.207407+00	0	1	healthy
6434	1	2026-06-25 10:27:43.266585+00	0	1	healthy
6435	5	2026-06-25 10:27:43.266585+00	0	1	healthy
6436	2	2026-06-25 10:27:43.266585+00	0	1	healthy
6437	3	2026-06-25 10:27:43.266585+00	0	1	healthy
6438	4	2026-06-25 10:27:43.266585+00	0	1	healthy
6469	1	2026-06-25 10:34:43.266246+00	0	1	healthy
6470	5	2026-06-25 10:34:43.266246+00	0	1	healthy
6471	2	2026-06-25 10:34:43.266246+00	0	1	healthy
6472	3	2026-06-25 10:34:43.266246+00	0	1	healthy
6473	4	2026-06-25 10:34:43.266246+00	0	1	healthy
6489	1	2026-06-25 10:38:43.266113+00	0	1	healthy
6490	5	2026-06-25 10:38:43.266113+00	0	1	healthy
6491	2	2026-06-25 10:38:43.266113+00	0	1	healthy
6492	3	2026-06-25 10:38:43.266113+00	0	1	healthy
6493	4	2026-06-25 10:38:43.266113+00	0	1	healthy
6519	1	2026-06-25 10:44:43.267714+00	0	1	healthy
6520	5	2026-06-25 10:44:43.267714+00	0	1	healthy
6521	2	2026-06-25 10:44:43.267714+00	0	1	healthy
6522	3	2026-06-25 10:44:43.267714+00	0	1	healthy
6523	4	2026-06-25 10:44:43.267714+00	0	1	healthy
6539	1	2026-06-25 10:48:43.264861+00	0	1	healthy
6540	5	2026-06-25 10:48:43.264861+00	0	1	healthy
6541	2	2026-06-25 10:48:43.264861+00	0	1	healthy
6542	3	2026-06-25 10:48:43.264861+00	0	1	healthy
6543	4	2026-06-25 10:48:43.264861+00	0	1	healthy
6549	1	2026-06-25 10:50:43.266119+00	0	1	healthy
6550	5	2026-06-25 10:50:43.266119+00	0	1	healthy
6551	2	2026-06-25 10:50:43.266119+00	0	1	healthy
6552	3	2026-06-25 10:50:43.266119+00	0	1	healthy
6553	4	2026-06-25 10:50:43.266119+00	0	1	healthy
6584	1	2026-06-25 10:57:43.264732+00	0	1	healthy
6585	5	2026-06-25 10:57:43.264732+00	0	1	healthy
6586	2	2026-06-25 10:57:43.264732+00	0	1	healthy
6587	3	2026-06-25 10:57:43.264732+00	0	1	healthy
6588	4	2026-06-25 10:57:43.264732+00	0	1	healthy
6619	1	2026-06-25 11:04:43.268167+00	0	1	healthy
6620	5	2026-06-25 11:04:43.268167+00	0	1	healthy
6621	2	2026-06-25 11:04:43.268167+00	0	1	healthy
6622	3	2026-06-25 11:04:43.268167+00	0	1	healthy
6623	4	2026-06-25 11:04:43.268167+00	0	1	healthy
6639	1	2026-06-25 11:08:43.265724+00	0	1	healthy
6640	5	2026-06-25 11:08:43.265724+00	0	1	healthy
6641	2	2026-06-25 11:08:43.265724+00	0	1	healthy
6642	3	2026-06-25 11:08:43.265724+00	0	1	healthy
6643	4	2026-06-25 11:08:43.265724+00	0	1	healthy
6669	1	2026-06-25 11:14:43.27262+00	0	1	healthy
6670	5	2026-06-25 11:14:43.27262+00	0	1	healthy
6671	2	2026-06-25 11:14:43.27262+00	0	1	healthy
6672	3	2026-06-25 11:14:43.27262+00	0	1	healthy
6673	4	2026-06-25 11:14:43.27262+00	0	1	healthy
6689	1	2026-06-25 12:52:43.268161+00	0	1	healthy
6690	5	2026-06-25 12:52:43.268161+00	0	1	healthy
6691	2	2026-06-25 12:52:43.268161+00	0	1	healthy
6692	3	2026-06-25 12:52:43.268161+00	0	1	healthy
6693	4	2026-06-25 12:52:43.268161+00	0	1	healthy
6739	1	2026-06-25 17:21:43.265373+00	0	1	healthy
6740	5	2026-06-25 17:21:43.265373+00	0	1	healthy
6741	2	2026-06-25 17:21:43.265373+00	0	1	healthy
6742	3	2026-06-25 17:21:43.265373+00	0	1	healthy
6743	4	2026-06-25 17:21:43.265373+00	0	1	healthy
6794	1	2026-06-25 17:32:43.265207+00	0	1	healthy
6795	5	2026-06-25 17:32:43.265207+00	0	1	healthy
6796	2	2026-06-25 17:32:43.265207+00	0	1	healthy
6797	3	2026-06-25 17:32:43.265207+00	0	1	healthy
6798	4	2026-06-25 17:32:43.265207+00	0	1	healthy
6809	1	2026-06-25 17:35:43.265479+00	0	1	healthy
6810	5	2026-06-25 17:35:43.265479+00	0	1	healthy
6811	2	2026-06-25 17:35:43.265479+00	0	1	healthy
6812	3	2026-06-25 17:35:43.265479+00	0	1	healthy
6813	4	2026-06-25 17:35:43.265479+00	0	1	healthy
6839	1	2026-06-25 18:11:43.267572+00	0	1	healthy
6840	5	2026-06-25 18:11:43.267572+00	0	1	healthy
6841	2	2026-06-25 18:11:43.267572+00	0	1	healthy
6842	3	2026-06-25 18:11:43.267572+00	0	1	healthy
6843	4	2026-06-25 18:11:43.267572+00	0	1	healthy
6889	1	2026-06-25 18:21:43.265653+00	0	1	healthy
6890	5	2026-06-25 18:21:43.265653+00	0	1	healthy
6891	2	2026-06-25 18:21:43.265653+00	0	1	healthy
6892	3	2026-06-25 18:21:43.265653+00	0	1	healthy
6893	4	2026-06-25 18:21:43.265653+00	0	1	healthy
6924	1	2026-06-25 20:19:43.272226+00	0	1	healthy
6925	5	2026-06-25 20:19:43.272226+00	0	1	healthy
6926	2	2026-06-25 20:19:43.272226+00	0	1	healthy
6927	3	2026-06-25 20:19:43.272226+00	0	1	healthy
6928	4	2026-06-25 20:19:43.272226+00	0	1	healthy
6944	1	2026-06-25 23:08:43.268221+00	0	1	healthy
6945	5	2026-06-25 23:08:43.268221+00	0	1	healthy
6946	2	2026-06-25 23:08:43.268221+00	0	1	healthy
6947	3	2026-06-25 23:08:43.268221+00	0	1	healthy
6948	4	2026-06-25 23:08:43.268221+00	0	1	healthy
6964	1	2026-06-26 01:00:43.267721+00	0	1	healthy
6965	5	2026-06-26 01:00:43.267721+00	0	1	healthy
6966	2	2026-06-26 01:00:43.267721+00	0	1	healthy
6967	3	2026-06-26 01:00:43.267721+00	0	1	healthy
6968	4	2026-06-26 01:00:43.267721+00	0	1	healthy
7019	1	2026-06-26 01:50:43.264909+00	0	1	healthy
7020	5	2026-06-26 01:50:43.264909+00	0	1	healthy
7021	2	2026-06-26 01:50:43.264909+00	0	1	healthy
7022	3	2026-06-26 01:50:43.264909+00	0	1	healthy
7023	4	2026-06-26 01:50:43.264909+00	0	1	healthy
7054	1	2026-06-26 02:03:43.267192+00	0	1	healthy
7055	5	2026-06-26 02:03:43.267192+00	0	1	healthy
7056	2	2026-06-26 02:03:43.267192+00	0	1	healthy
7057	3	2026-06-26 02:03:43.267192+00	0	1	healthy
7058	4	2026-06-26 02:03:43.267192+00	0	1	healthy
7074	1	2026-06-26 02:07:43.264917+00	0	1	healthy
7075	5	2026-06-26 02:07:43.264917+00	0	1	healthy
7076	2	2026-06-26 02:07:43.264917+00	0	1	healthy
7077	3	2026-06-26 02:07:43.264917+00	0	1	healthy
7078	4	2026-06-26 02:07:43.264917+00	0	1	healthy
7094	1	2026-06-26 02:11:43.266151+00	0	1	healthy
7095	5	2026-06-26 02:11:43.266151+00	0	1	healthy
7096	2	2026-06-26 02:11:43.266151+00	0	1	healthy
7097	3	2026-06-26 02:11:43.266151+00	0	1	healthy
7098	4	2026-06-26 02:11:43.266151+00	0	1	healthy
3791	1	2026-06-24 10:02:39.180884+00	0	1	healthy
3792	5	2026-06-24 10:02:39.180884+00	0	1	healthy
3793	2	2026-06-24 10:02:39.180884+00	0	1	healthy
3794	3	2026-06-24 10:02:39.180884+00	0	1	healthy
3795	4	2026-06-24 10:02:39.180884+00	0	1	healthy
3796	1	2026-06-24 10:03:39.182271+00	0	1	healthy
3797	5	2026-06-24 10:03:39.182271+00	0	1	healthy
3798	2	2026-06-24 10:03:39.182271+00	0	1	healthy
3799	3	2026-06-24 10:03:39.182271+00	0	1	healthy
3800	4	2026-06-24 10:03:39.182271+00	0	1	healthy
3801	1	2026-06-24 10:04:39.188971+00	0	1	healthy
3802	5	2026-06-24 10:04:39.188971+00	0	1	healthy
3803	2	2026-06-24 10:04:39.188971+00	0	1	healthy
3804	3	2026-06-24 10:04:39.188971+00	0	1	healthy
3805	4	2026-06-24 10:04:39.188971+00	0	1	healthy
3806	1	2026-06-24 10:05:39.181512+00	0	1	healthy
3807	5	2026-06-24 10:05:39.181512+00	0	1	healthy
3808	2	2026-06-24 10:05:39.181512+00	0	1	healthy
3809	3	2026-06-24 10:05:39.181512+00	0	1	healthy
3810	4	2026-06-24 10:05:39.181512+00	0	1	healthy
3811	1	2026-06-24 10:06:39.181066+00	0	1	healthy
3812	5	2026-06-24 10:06:39.181066+00	0	1	healthy
3813	2	2026-06-24 10:06:39.181066+00	0	1	healthy
3814	3	2026-06-24 10:06:39.181066+00	0	1	healthy
3815	4	2026-06-24 10:06:39.181066+00	0	1	healthy
3816	1	2026-06-24 10:07:39.18046+00	0	1	healthy
3817	5	2026-06-24 10:07:39.18046+00	0	1	healthy
3818	2	2026-06-24 10:07:39.18046+00	0	1	healthy
3819	3	2026-06-24 10:07:39.18046+00	0	1	healthy
3820	4	2026-06-24 10:07:39.18046+00	0	1	healthy
3821	1	2026-06-24 10:08:39.180405+00	0	1	healthy
3822	5	2026-06-24 10:08:39.180405+00	0	1	healthy
3823	2	2026-06-24 10:08:39.180405+00	0	1	healthy
3824	3	2026-06-24 10:08:39.180405+00	0	1	healthy
3825	4	2026-06-24 10:08:39.180405+00	0	1	healthy
3826	1	2026-06-24 10:09:39.179466+00	0	1	healthy
3827	5	2026-06-24 10:09:39.179466+00	0	1	healthy
3828	2	2026-06-24 10:09:39.179466+00	0	1	healthy
3829	3	2026-06-24 10:09:39.179466+00	0	1	healthy
3830	4	2026-06-24 10:09:39.179466+00	0	1	healthy
3831	1	2026-06-24 10:10:39.178959+00	0	1	healthy
3832	5	2026-06-24 10:10:39.178959+00	0	1	healthy
3833	2	2026-06-24 10:10:39.178959+00	0	1	healthy
3834	3	2026-06-24 10:10:39.178959+00	0	1	healthy
3835	4	2026-06-24 10:10:39.178959+00	0	1	healthy
3836	1	2026-06-24 10:11:39.179214+00	0	1	healthy
3837	5	2026-06-24 10:11:39.179214+00	0	1	healthy
3838	2	2026-06-24 10:11:39.179214+00	0	1	healthy
3839	3	2026-06-24 10:11:39.179214+00	0	1	healthy
3840	4	2026-06-24 10:11:39.179214+00	0	1	healthy
3841	1	2026-06-24 10:12:39.19135+00	0	1	healthy
3842	5	2026-06-24 10:12:39.19135+00	0	1	healthy
3843	2	2026-06-24 10:12:39.19135+00	0	1	healthy
3844	3	2026-06-24 10:12:39.19135+00	0	1	healthy
3845	4	2026-06-24 10:12:39.19135+00	0	1	healthy
3846	1	2026-06-24 10:13:39.183911+00	0	1	healthy
3847	5	2026-06-24 10:13:39.183911+00	0	1	healthy
3848	2	2026-06-24 10:13:39.183911+00	0	1	healthy
3849	3	2026-06-24 10:13:39.183911+00	0	1	healthy
3850	4	2026-06-24 10:13:39.183911+00	0	1	healthy
3851	1	2026-06-24 10:14:39.178769+00	0	1	healthy
3852	5	2026-06-24 10:14:39.178769+00	0	1	healthy
3853	2	2026-06-24 10:14:39.178769+00	0	1	healthy
3854	3	2026-06-24 10:14:39.178769+00	0	1	healthy
3855	4	2026-06-24 10:14:39.178769+00	0	1	healthy
3856	1	2026-06-24 10:15:39.179864+00	0	1	healthy
3857	5	2026-06-24 10:15:39.179864+00	0	1	healthy
3858	2	2026-06-24 10:15:39.179864+00	0	1	healthy
3859	3	2026-06-24 10:15:39.179864+00	0	1	healthy
3860	4	2026-06-24 10:15:39.179864+00	0	1	healthy
3861	1	2026-06-24 10:16:39.180617+00	0	1	healthy
3862	5	2026-06-24 10:16:39.180617+00	0	1	healthy
3863	2	2026-06-24 10:16:39.180617+00	0	1	healthy
3864	3	2026-06-24 10:16:39.180617+00	0	1	healthy
3865	4	2026-06-24 10:16:39.180617+00	0	1	healthy
3866	1	2026-06-24 10:17:39.194114+00	0	1	healthy
3867	5	2026-06-24 10:17:39.194114+00	0	1	healthy
3868	2	2026-06-24 10:17:39.194114+00	0	1	healthy
3869	3	2026-06-24 10:17:39.194114+00	0	1	healthy
3870	4	2026-06-24 10:17:39.194114+00	0	1	healthy
3871	1	2026-06-24 10:18:39.180937+00	0	1	healthy
3872	5	2026-06-24 10:18:39.180937+00	0	1	healthy
3873	2	2026-06-24 10:18:39.180937+00	0	1	healthy
3874	3	2026-06-24 10:18:39.180937+00	0	1	healthy
3875	4	2026-06-24 10:18:39.180937+00	0	1	healthy
3876	1	2026-06-24 10:19:39.179021+00	0	1	healthy
3877	5	2026-06-24 10:19:39.179021+00	0	1	healthy
3878	2	2026-06-24 10:19:39.179021+00	0	1	healthy
3879	3	2026-06-24 10:19:39.179021+00	0	1	healthy
3880	4	2026-06-24 10:19:39.179021+00	0	1	healthy
3881	1	2026-06-24 10:20:39.179341+00	0	1	healthy
3882	5	2026-06-24 10:20:39.179341+00	0	1	healthy
3883	2	2026-06-24 10:20:39.179341+00	0	1	healthy
3884	3	2026-06-24 10:20:39.179341+00	0	1	healthy
3885	4	2026-06-24 10:20:39.179341+00	0	1	healthy
3886	1	2026-06-24 10:24:39.179794+00	0	1	healthy
3887	5	2026-06-24 10:24:39.179794+00	0	1	healthy
3888	2	2026-06-24 10:24:39.179794+00	0	1	healthy
3889	3	2026-06-24 10:24:39.179794+00	0	1	healthy
3890	4	2026-06-24 10:24:39.179794+00	0	1	healthy
3891	1	2026-06-24 10:25:39.179624+00	0	1	healthy
3892	5	2026-06-24 10:25:39.179624+00	0	1	healthy
3893	2	2026-06-24 10:25:39.179624+00	0	1	healthy
3894	3	2026-06-24 10:25:39.179624+00	0	1	healthy
3895	4	2026-06-24 10:25:39.179624+00	0	1	healthy
3896	1	2026-06-24 10:26:39.180017+00	0	1	healthy
3897	5	2026-06-24 10:26:39.180017+00	0	1	healthy
3898	2	2026-06-24 10:26:39.180017+00	0	1	healthy
3899	3	2026-06-24 10:26:39.180017+00	0	1	healthy
3900	4	2026-06-24 10:26:39.180017+00	0	1	healthy
3901	1	2026-06-24 10:27:39.18222+00	0	1	healthy
3902	5	2026-06-24 10:27:39.18222+00	0	1	healthy
3903	2	2026-06-24 10:27:39.18222+00	0	1	healthy
3904	3	2026-06-24 10:27:39.18222+00	0	1	healthy
3905	4	2026-06-24 10:27:39.18222+00	0	1	healthy
3906	1	2026-06-24 10:28:39.180564+00	0	1	healthy
3907	5	2026-06-24 10:28:39.180564+00	0	1	healthy
3908	2	2026-06-24 10:28:39.180564+00	0	1	healthy
3909	3	2026-06-24 10:28:39.180564+00	0	1	healthy
3910	4	2026-06-24 10:28:39.180564+00	0	1	healthy
3911	1	2026-06-24 10:29:39.185298+00	0	1	healthy
3912	5	2026-06-24 10:29:39.185298+00	0	1	healthy
3913	2	2026-06-24 10:29:39.185298+00	0	1	healthy
3914	3	2026-06-24 10:29:39.185298+00	0	1	healthy
3915	4	2026-06-24 10:29:39.185298+00	0	1	healthy
3916	1	2026-06-24 10:30:39.178837+00	0	1	healthy
3917	5	2026-06-24 10:30:39.178837+00	0	1	healthy
3918	2	2026-06-24 10:30:39.178837+00	0	1	healthy
3919	3	2026-06-24 10:30:39.178837+00	0	1	healthy
3920	4	2026-06-24 10:30:39.178837+00	0	1	healthy
3921	1	2026-06-24 10:31:39.179663+00	0	1	healthy
3922	5	2026-06-24 10:31:39.179663+00	0	1	healthy
3923	2	2026-06-24 10:31:39.179663+00	0	1	healthy
3924	3	2026-06-24 10:31:39.179663+00	0	1	healthy
3925	4	2026-06-24 10:31:39.179663+00	0	1	healthy
3946	1	2026-06-24 10:36:39.185524+00	0	1	healthy
3947	5	2026-06-24 10:36:39.185524+00	0	1	healthy
3948	2	2026-06-24 10:36:39.185524+00	0	1	healthy
3949	3	2026-06-24 10:36:39.185524+00	0	1	healthy
3950	4	2026-06-24 10:36:39.185524+00	0	1	healthy
3961	1	2026-06-24 10:39:39.180103+00	0	1	healthy
3962	5	2026-06-24 10:39:39.180103+00	0	1	healthy
3963	2	2026-06-24 10:39:39.180103+00	0	1	healthy
3964	3	2026-06-24 10:39:39.180103+00	0	1	healthy
3965	4	2026-06-24 10:39:39.180103+00	0	1	healthy
4006	1	2026-06-24 10:48:39.181055+00	0	1	healthy
4007	5	2026-06-24 10:48:39.181055+00	0	1	healthy
4008	2	2026-06-24 10:48:39.181055+00	0	1	healthy
4009	3	2026-06-24 10:48:39.181055+00	0	1	healthy
4010	4	2026-06-24 10:48:39.181055+00	0	1	healthy
6439	1	2026-06-25 10:28:43.265838+00	0	1	healthy
6440	5	2026-06-25 10:28:43.265838+00	0	1	healthy
6441	2	2026-06-25 10:28:43.265838+00	0	1	healthy
6442	3	2026-06-25 10:28:43.265838+00	0	1	healthy
6443	4	2026-06-25 10:28:43.265838+00	0	1	healthy
6449	1	2026-06-25 10:30:43.265995+00	0	1	healthy
6450	5	2026-06-25 10:30:43.265995+00	0	1	healthy
6451	2	2026-06-25 10:30:43.265995+00	0	1	healthy
6452	3	2026-06-25 10:30:43.265995+00	0	1	healthy
6453	4	2026-06-25 10:30:43.265995+00	0	1	healthy
6484	1	2026-06-25 10:37:43.265586+00	0	1	healthy
6485	5	2026-06-25 10:37:43.265586+00	0	1	healthy
6486	2	2026-06-25 10:37:43.265586+00	0	1	healthy
6487	3	2026-06-25 10:37:43.265586+00	0	1	healthy
6488	4	2026-06-25 10:37:43.265586+00	0	1	healthy
6499	1	2026-06-25 10:40:43.265941+00	0	1	healthy
6500	5	2026-06-25 10:40:43.265941+00	0	1	healthy
6501	2	2026-06-25 10:40:43.265941+00	0	1	healthy
6502	3	2026-06-25 10:40:43.265941+00	0	1	healthy
6503	4	2026-06-25 10:40:43.265941+00	0	1	healthy
6534	1	2026-06-25 10:47:43.265635+00	0	1	healthy
6535	5	2026-06-25 10:47:43.265635+00	0	1	healthy
6536	2	2026-06-25 10:47:43.265635+00	0	1	healthy
6537	3	2026-06-25 10:47:43.265635+00	0	1	healthy
6538	4	2026-06-25 10:47:43.265635+00	0	1	healthy
6569	1	2026-06-25 10:54:43.264426+00	0	1	healthy
6570	5	2026-06-25 10:54:43.264426+00	0	1	healthy
6571	2	2026-06-25 10:54:43.264426+00	0	1	healthy
6572	3	2026-06-25 10:54:43.264426+00	0	1	healthy
6573	4	2026-06-25 10:54:43.264426+00	0	1	healthy
6589	1	2026-06-25 10:58:43.264837+00	0	1	healthy
6590	5	2026-06-25 10:58:43.264837+00	0	1	healthy
6591	2	2026-06-25 10:58:43.264837+00	0	1	healthy
6592	3	2026-06-25 10:58:43.264837+00	0	1	healthy
6593	4	2026-06-25 10:58:43.264837+00	0	1	healthy
6599	1	2026-06-25 11:00:43.265938+00	0	1	healthy
6600	5	2026-06-25 11:00:43.265938+00	0	1	healthy
6601	2	2026-06-25 11:00:43.265938+00	0	1	healthy
6602	3	2026-06-25 11:00:43.265938+00	0	1	healthy
6603	4	2026-06-25 11:00:43.265938+00	0	1	healthy
6634	1	2026-06-25 11:07:43.265542+00	0	1	healthy
6635	5	2026-06-25 11:07:43.265542+00	0	1	healthy
6636	2	2026-06-25 11:07:43.265542+00	0	1	healthy
6637	3	2026-06-25 11:07:43.265542+00	0	1	healthy
6638	4	2026-06-25 11:07:43.265542+00	0	1	healthy
6654	1	2026-06-25 11:11:43.265013+00	0	1	healthy
6655	5	2026-06-25 11:11:43.265013+00	0	1	healthy
6656	2	2026-06-25 11:11:43.265013+00	0	1	healthy
6657	3	2026-06-25 11:11:43.265013+00	0	1	healthy
6658	4	2026-06-25 11:11:43.265013+00	0	1	healthy
6694	1	2026-06-25 13:10:43.267245+00	0	1	healthy
6695	5	2026-06-25 13:10:43.267245+00	0	1	healthy
6696	2	2026-06-25 13:10:43.267245+00	0	1	healthy
6697	3	2026-06-25 13:10:43.267245+00	0	1	healthy
6698	4	2026-06-25 13:10:43.267245+00	0	1	healthy
6709	1	2026-06-25 15:03:43.266912+00	0	1	healthy
6710	5	2026-06-25 15:03:43.266912+00	0	1	healthy
6711	2	2026-06-25 15:03:43.266912+00	0	1	healthy
6712	3	2026-06-25 15:03:43.266912+00	0	1	healthy
6713	4	2026-06-25 15:03:43.266912+00	0	1	healthy
6729	1	2026-06-25 17:19:43.271763+00	0	1	healthy
6730	5	2026-06-25 17:19:43.271763+00	0	1	healthy
6731	2	2026-06-25 17:19:43.271763+00	0	1	healthy
6732	3	2026-06-25 17:19:43.271763+00	0	1	healthy
6733	4	2026-06-25 17:19:43.271763+00	0	1	healthy
6749	1	2026-06-25 17:23:43.266115+00	0	1	healthy
6750	5	2026-06-25 17:23:43.266115+00	0	1	healthy
6751	2	2026-06-25 17:23:43.266115+00	0	1	healthy
6752	3	2026-06-25 17:23:43.266115+00	0	1	healthy
6753	4	2026-06-25 17:23:43.266115+00	0	1	healthy
6764	1	2026-06-25 17:26:43.265584+00	0	1	healthy
6765	5	2026-06-25 17:26:43.265584+00	0	1	healthy
6766	2	2026-06-25 17:26:43.265584+00	0	1	healthy
6767	3	2026-06-25 17:26:43.265584+00	0	1	healthy
6768	4	2026-06-25 17:26:43.265584+00	0	1	healthy
6789	1	2026-06-25 17:31:43.265854+00	0	1	healthy
6790	5	2026-06-25 17:31:43.265854+00	0	1	healthy
6791	2	2026-06-25 17:31:43.265854+00	0	1	healthy
6792	3	2026-06-25 17:31:43.265854+00	0	1	healthy
6793	4	2026-06-25 17:31:43.265854+00	0	1	healthy
6844	1	2026-06-25 18:12:43.26786+00	0	1	healthy
6845	5	2026-06-25 18:12:43.26786+00	0	1	healthy
6846	2	2026-06-25 18:12:43.26786+00	0	1	healthy
6847	3	2026-06-25 18:12:43.26786+00	0	1	healthy
6848	4	2026-06-25 18:12:43.26786+00	0	1	healthy
6859	1	2026-06-25 18:15:43.26605+00	0	1	healthy
6860	5	2026-06-25 18:15:43.26605+00	0	1	healthy
6861	2	2026-06-25 18:15:43.26605+00	0	1	healthy
6862	3	2026-06-25 18:15:43.26605+00	0	1	healthy
6863	4	2026-06-25 18:15:43.26605+00	0	1	healthy
3926	1	2026-06-24 10:32:39.181995+00	0	1	healthy
3927	5	2026-06-24 10:32:39.181995+00	0	1	healthy
3928	2	2026-06-24 10:32:39.181995+00	0	1	healthy
3929	3	2026-06-24 10:32:39.181995+00	0	1	healthy
3930	4	2026-06-24 10:32:39.181995+00	0	1	healthy
3931	1	2026-06-24 10:33:39.180268+00	0	1	healthy
3932	5	2026-06-24 10:33:39.180268+00	0	1	healthy
3933	2	2026-06-24 10:33:39.180268+00	0	1	healthy
3934	3	2026-06-24 10:33:39.180268+00	0	1	healthy
3935	4	2026-06-24 10:33:39.180268+00	0	1	healthy
3936	1	2026-06-24 10:34:39.178472+00	0	1	healthy
3937	5	2026-06-24 10:34:39.178472+00	0	1	healthy
3938	2	2026-06-24 10:34:39.178472+00	0	1	healthy
3939	3	2026-06-24 10:34:39.178472+00	0	1	healthy
3940	4	2026-06-24 10:34:39.178472+00	0	1	healthy
3956	1	2026-06-24 10:38:39.179224+00	0	1	healthy
3957	5	2026-06-24 10:38:39.179224+00	0	1	healthy
3958	2	2026-06-24 10:38:39.179224+00	0	1	healthy
3959	3	2026-06-24 10:38:39.179224+00	0	1	healthy
3960	4	2026-06-24 10:38:39.179224+00	0	1	healthy
3966	1	2026-06-24 10:40:39.180101+00	0	1	healthy
3967	5	2026-06-24 10:40:39.180101+00	0	1	healthy
3968	2	2026-06-24 10:40:39.180101+00	0	1	healthy
3969	3	2026-06-24 10:40:39.180101+00	0	1	healthy
3970	4	2026-06-24 10:40:39.180101+00	0	1	healthy
3981	1	2026-06-24 10:43:39.183474+00	0	1	healthy
3982	5	2026-06-24 10:43:39.183474+00	0	1	healthy
3983	2	2026-06-24 10:43:39.183474+00	0	1	healthy
3984	3	2026-06-24 10:43:39.183474+00	0	1	healthy
3985	4	2026-06-24 10:43:39.183474+00	0	1	healthy
3991	1	2026-06-24 10:45:39.180192+00	0	1	healthy
3992	5	2026-06-24 10:45:39.180192+00	0	1	healthy
3993	2	2026-06-24 10:45:39.180192+00	0	1	healthy
3994	3	2026-06-24 10:45:39.180192+00	0	1	healthy
3995	4	2026-06-24 10:45:39.180192+00	0	1	healthy
3996	1	2026-06-24 10:46:39.178662+00	0	1	healthy
3997	5	2026-06-24 10:46:39.178662+00	0	1	healthy
3998	2	2026-06-24 10:46:39.178662+00	0	1	healthy
3999	3	2026-06-24 10:46:39.178662+00	0	1	healthy
4000	4	2026-06-24 10:46:39.178662+00	0	1	healthy
6444	1	2026-06-25 10:29:43.267987+00	0	1	healthy
6445	5	2026-06-25 10:29:43.267987+00	0	1	healthy
6446	2	2026-06-25 10:29:43.267987+00	0	1	healthy
6447	3	2026-06-25 10:29:43.267987+00	0	1	healthy
6448	4	2026-06-25 10:29:43.267987+00	0	1	healthy
6464	1	2026-06-25 10:33:43.265839+00	0	1	healthy
6465	5	2026-06-25 10:33:43.265839+00	0	1	healthy
6466	2	2026-06-25 10:33:43.265839+00	0	1	healthy
6467	3	2026-06-25 10:33:43.265839+00	0	1	healthy
6468	4	2026-06-25 10:33:43.265839+00	0	1	healthy
6479	1	2026-06-25 10:36:43.266022+00	0	1	healthy
6480	5	2026-06-25 10:36:43.266022+00	0	1	healthy
6481	2	2026-06-25 10:36:43.266022+00	0	1	healthy
6482	3	2026-06-25 10:36:43.266022+00	0	1	healthy
6483	4	2026-06-25 10:36:43.266022+00	0	1	healthy
6494	1	2026-06-25 10:39:43.267008+00	0	1	healthy
6495	5	2026-06-25 10:39:43.267008+00	0	1	healthy
6496	2	2026-06-25 10:39:43.267008+00	0	1	healthy
6497	3	2026-06-25 10:39:43.267008+00	0	1	healthy
6498	4	2026-06-25 10:39:43.267008+00	0	1	healthy
6514	1	2026-06-25 10:43:43.265259+00	0	1	healthy
6515	5	2026-06-25 10:43:43.265259+00	0	1	healthy
6516	2	2026-06-25 10:43:43.265259+00	0	1	healthy
6517	3	2026-06-25 10:43:43.265259+00	0	1	healthy
6518	4	2026-06-25 10:43:43.265259+00	0	1	healthy
6529	1	2026-06-25 10:46:43.266014+00	0	1	healthy
6530	5	2026-06-25 10:46:43.266014+00	0	1	healthy
6531	2	2026-06-25 10:46:43.266014+00	0	1	healthy
6532	3	2026-06-25 10:46:43.266014+00	0	1	healthy
6533	4	2026-06-25 10:46:43.266014+00	0	1	healthy
6559	1	2026-06-25 10:52:43.265526+00	0	1	healthy
6560	5	2026-06-25 10:52:43.265526+00	0	1	healthy
6561	2	2026-06-25 10:52:43.265526+00	0	1	healthy
6562	3	2026-06-25 10:52:43.265526+00	0	1	healthy
6563	4	2026-06-25 10:52:43.265526+00	0	1	healthy
6574	1	2026-06-25 10:55:43.264933+00	0	1	healthy
6575	5	2026-06-25 10:55:43.264933+00	0	1	healthy
6576	2	2026-06-25 10:55:43.264933+00	0	1	healthy
6577	3	2026-06-25 10:55:43.264933+00	0	1	healthy
6578	4	2026-06-25 10:55:43.264933+00	0	1	healthy
6594	1	2026-06-25 10:59:43.267973+00	0	1	healthy
6595	5	2026-06-25 10:59:43.267973+00	0	1	healthy
6596	2	2026-06-25 10:59:43.267973+00	0	1	healthy
6597	3	2026-06-25 10:59:43.267973+00	0	1	healthy
6598	4	2026-06-25 10:59:43.267973+00	0	1	healthy
6614	1	2026-06-25 11:03:43.265725+00	0	1	healthy
6615	5	2026-06-25 11:03:43.265725+00	0	1	healthy
6616	2	2026-06-25 11:03:43.265725+00	0	1	healthy
6617	3	2026-06-25 11:03:43.265725+00	0	1	healthy
6618	4	2026-06-25 11:03:43.265725+00	0	1	healthy
6629	1	2026-06-25 11:06:43.264432+00	0	1	healthy
6630	5	2026-06-25 11:06:43.264432+00	0	1	healthy
6631	2	2026-06-25 11:06:43.264432+00	0	1	healthy
6632	3	2026-06-25 11:06:43.264432+00	0	1	healthy
6633	4	2026-06-25 11:06:43.264432+00	0	1	healthy
6644	1	2026-06-25 11:09:43.267883+00	0	1	healthy
6645	5	2026-06-25 11:09:43.267883+00	0	1	healthy
6646	2	2026-06-25 11:09:43.267883+00	0	1	healthy
6647	3	2026-06-25 11:09:43.267883+00	0	1	healthy
6648	4	2026-06-25 11:09:43.267883+00	0	1	healthy
6664	1	2026-06-25 11:13:43.264653+00	0	1	healthy
6665	5	2026-06-25 11:13:43.264653+00	0	1	healthy
6666	2	2026-06-25 11:13:43.264653+00	0	1	healthy
6667	3	2026-06-25 11:13:43.264653+00	0	1	healthy
6668	4	2026-06-25 11:13:43.264653+00	0	1	healthy
6679	1	2026-06-25 11:16:43.264651+00	0	1	healthy
6680	5	2026-06-25 11:16:43.264651+00	0	1	healthy
6681	2	2026-06-25 11:16:43.264651+00	0	1	healthy
6682	3	2026-06-25 11:16:43.264651+00	0	1	healthy
6683	4	2026-06-25 11:16:43.264651+00	0	1	healthy
6704	1	2026-06-25 14:44:43.27084+00	0	1	healthy
6705	5	2026-06-25 14:44:43.27084+00	0	1	healthy
6706	2	2026-06-25 14:44:43.27084+00	0	1	healthy
6707	3	2026-06-25 14:44:43.27084+00	0	1	healthy
6708	4	2026-06-25 14:44:43.27084+00	0	1	healthy
6724	1	2026-06-25 17:18:43.26798+00	0	1	healthy
6725	5	2026-06-25 17:18:43.26798+00	0	1	healthy
6726	2	2026-06-25 17:18:43.26798+00	0	1	healthy
6727	3	2026-06-25 17:18:43.26798+00	0	1	healthy
6728	4	2026-06-25 17:18:43.26798+00	0	1	healthy
3941	1	2026-06-24 10:35:39.178449+00	0	1	healthy
3942	5	2026-06-24 10:35:39.178449+00	0	1	healthy
3943	2	2026-06-24 10:35:39.178449+00	0	1	healthy
3944	3	2026-06-24 10:35:39.178449+00	0	1	healthy
3945	4	2026-06-24 10:35:39.178449+00	0	1	healthy
3951	1	2026-06-24 10:37:39.18132+00	0	1	healthy
3952	5	2026-06-24 10:37:39.18132+00	0	1	healthy
3953	2	2026-06-24 10:37:39.18132+00	0	1	healthy
3954	3	2026-06-24 10:37:39.18132+00	0	1	healthy
3955	4	2026-06-24 10:37:39.18132+00	0	1	healthy
3971	1	2026-06-24 10:41:39.18009+00	0	1	healthy
3972	5	2026-06-24 10:41:39.18009+00	0	1	healthy
3973	2	2026-06-24 10:41:39.18009+00	0	1	healthy
3974	3	2026-06-24 10:41:39.18009+00	0	1	healthy
3975	4	2026-06-24 10:41:39.18009+00	0	1	healthy
3986	1	2026-06-24 10:44:39.179826+00	0	1	healthy
3987	5	2026-06-24 10:44:39.179826+00	0	1	healthy
3988	2	2026-06-24 10:44:39.179826+00	0	1	healthy
3989	3	2026-06-24 10:44:39.179826+00	0	1	healthy
3990	4	2026-06-24 10:44:39.179826+00	0	1	healthy
4001	1	2026-06-24 10:47:39.259356+00	0	1	healthy
4002	5	2026-06-24 10:47:39.259356+00	0	1	healthy
4003	2	2026-06-24 10:47:39.259356+00	0	1	healthy
4004	3	2026-06-24 10:47:39.259356+00	0	1	healthy
4005	4	2026-06-24 10:47:39.259356+00	0	1	healthy
6454	1	2026-06-25 10:31:43.264934+00	0	1	healthy
6455	5	2026-06-25 10:31:43.264934+00	0	1	healthy
6456	2	2026-06-25 10:31:43.264934+00	0	1	healthy
6457	3	2026-06-25 10:31:43.264934+00	0	1	healthy
6458	4	2026-06-25 10:31:43.264934+00	0	1	healthy
6509	1	2026-06-25 10:42:43.265354+00	0	1	healthy
6510	5	2026-06-25 10:42:43.265354+00	0	1	healthy
6511	2	2026-06-25 10:42:43.265354+00	0	1	healthy
6512	3	2026-06-25 10:42:43.265354+00	0	1	healthy
6513	4	2026-06-25 10:42:43.265354+00	0	1	healthy
6524	1	2026-06-25 10:45:43.26552+00	0	1	healthy
6525	5	2026-06-25 10:45:43.26552+00	0	1	healthy
6526	2	2026-06-25 10:45:43.26552+00	0	1	healthy
6527	3	2026-06-25 10:45:43.26552+00	0	1	healthy
6528	4	2026-06-25 10:45:43.26552+00	0	1	healthy
6544	1	2026-06-25 10:49:43.266044+00	0	1	healthy
6545	5	2026-06-25 10:49:43.266044+00	0	1	healthy
6546	2	2026-06-25 10:49:43.266044+00	0	1	healthy
6547	3	2026-06-25 10:49:43.266044+00	0	1	healthy
6548	4	2026-06-25 10:49:43.266044+00	0	1	healthy
6564	1	2026-06-25 10:53:43.265413+00	0	1	healthy
6565	5	2026-06-25 10:53:43.265413+00	0	1	healthy
6566	2	2026-06-25 10:53:43.265413+00	0	1	healthy
6567	3	2026-06-25 10:53:43.265413+00	0	1	healthy
6568	4	2026-06-25 10:53:43.265413+00	0	1	healthy
6579	1	2026-06-25 10:56:43.264473+00	0	1	healthy
6580	5	2026-06-25 10:56:43.264473+00	0	1	healthy
6581	2	2026-06-25 10:56:43.264473+00	0	1	healthy
6582	3	2026-06-25 10:56:43.264473+00	0	1	healthy
6583	4	2026-06-25 10:56:43.264473+00	0	1	healthy
6609	1	2026-06-25 11:02:43.264736+00	0	1	healthy
6610	5	2026-06-25 11:02:43.264736+00	0	1	healthy
6611	2	2026-06-25 11:02:43.264736+00	0	1	healthy
6612	3	2026-06-25 11:02:43.264736+00	0	1	healthy
6613	4	2026-06-25 11:02:43.264736+00	0	1	healthy
6624	1	2026-06-25 11:05:43.331423+00	0	1	healthy
6625	5	2026-06-25 11:05:43.331423+00	0	1	healthy
6626	2	2026-06-25 11:05:43.331423+00	0	1	healthy
6627	3	2026-06-25 11:05:43.331423+00	0	1	healthy
6628	4	2026-06-25 11:05:43.331423+00	0	1	healthy
6649	1	2026-06-25 11:10:43.265256+00	0	1	healthy
6650	5	2026-06-25 11:10:43.265256+00	0	1	healthy
6651	2	2026-06-25 11:10:43.265256+00	0	1	healthy
6652	3	2026-06-25 11:10:43.265256+00	0	1	healthy
6653	4	2026-06-25 11:10:43.265256+00	0	1	healthy
6684	1	2026-06-25 12:17:43.269107+00	0	1	healthy
6685	5	2026-06-25 12:17:43.269107+00	0	1	healthy
6686	2	2026-06-25 12:17:43.269107+00	0	1	healthy
6687	3	2026-06-25 12:17:43.269107+00	0	1	healthy
6688	4	2026-06-25 12:17:43.269107+00	0	1	healthy
6719	1	2026-06-25 16:27:43.29187+00	0	1	healthy
6720	5	2026-06-25 16:27:43.29187+00	0	1	healthy
6721	2	2026-06-25 16:27:43.29187+00	0	1	healthy
6722	3	2026-06-25 16:27:43.29187+00	0	1	healthy
6723	4	2026-06-25 16:27:43.29187+00	0	1	healthy
6754	1	2026-06-25 17:24:43.266516+00	0	1	healthy
6755	5	2026-06-25 17:24:43.266516+00	0	1	healthy
6756	2	2026-06-25 17:24:43.266516+00	0	1	healthy
6757	3	2026-06-25 17:24:43.266516+00	0	1	healthy
6758	4	2026-06-25 17:24:43.266516+00	0	1	healthy
6774	1	2026-06-25 17:28:43.26549+00	0	1	healthy
6775	5	2026-06-25 17:28:43.26549+00	0	1	healthy
6776	2	2026-06-25 17:28:43.26549+00	0	1	healthy
6777	3	2026-06-25 17:28:43.26549+00	0	1	healthy
6778	4	2026-06-25 17:28:43.26549+00	0	1	healthy
6784	1	2026-06-25 17:30:43.266264+00	0	1	healthy
6785	5	2026-06-25 17:30:43.266264+00	0	1	healthy
6786	2	2026-06-25 17:30:43.266264+00	0	1	healthy
6787	3	2026-06-25 17:30:43.266264+00	0	1	healthy
6788	4	2026-06-25 17:30:43.266264+00	0	1	healthy
6819	1	2026-06-25 17:37:43.265174+00	0	1	healthy
6820	5	2026-06-25 17:37:43.265174+00	0	1	healthy
6821	2	2026-06-25 17:37:43.265174+00	0	1	healthy
6822	3	2026-06-25 17:37:43.265174+00	0	1	healthy
6823	4	2026-06-25 17:37:43.265174+00	0	1	healthy
6834	1	2026-06-25 17:40:43.266201+00	0	1	healthy
6835	5	2026-06-25 17:40:43.266201+00	0	1	healthy
6836	2	2026-06-25 17:40:43.266201+00	0	1	healthy
6837	3	2026-06-25 17:40:43.266201+00	0	1	healthy
6838	4	2026-06-25 17:40:43.266201+00	0	1	healthy
6869	1	2026-06-25 18:17:43.264746+00	0	1	healthy
6870	5	2026-06-25 18:17:43.264746+00	0	1	healthy
6871	2	2026-06-25 18:17:43.264746+00	0	1	healthy
6872	3	2026-06-25 18:17:43.264746+00	0	1	healthy
6873	4	2026-06-25 18:17:43.264746+00	0	1	healthy
6904	1	2026-06-25 18:24:43.26704+00	0	1	healthy
6905	5	2026-06-25 18:24:43.26704+00	0	1	healthy
6906	2	2026-06-25 18:24:43.26704+00	0	1	healthy
6907	3	2026-06-25 18:24:43.26704+00	0	1	healthy
6908	4	2026-06-25 18:24:43.26704+00	0	1	healthy
6934	1	2026-06-25 22:01:43.267005+00	0	1	healthy
6935	5	2026-06-25 22:01:43.267005+00	0	1	healthy
6936	2	2026-06-25 22:01:43.267005+00	0	1	healthy
6937	3	2026-06-25 22:01:43.267005+00	0	1	healthy
6938	4	2026-06-25 22:01:43.267005+00	0	1	healthy
3976	1	2026-06-24 10:42:39.178711+00	0	1	healthy
3977	5	2026-06-24 10:42:39.178711+00	0	1	healthy
3978	2	2026-06-24 10:42:39.178711+00	0	1	healthy
3979	3	2026-06-24 10:42:39.178711+00	0	1	healthy
3980	4	2026-06-24 10:42:39.178711+00	0	1	healthy
4011	1	2026-06-24 10:49:39.179261+00	0	1	healthy
4012	5	2026-06-24 10:49:39.179261+00	0	1	healthy
4013	2	2026-06-24 10:49:39.179261+00	0	1	healthy
4014	3	2026-06-24 10:49:39.179261+00	0	1	healthy
4015	4	2026-06-24 10:49:39.179261+00	0	1	healthy
4016	1	2026-06-24 10:51:32.948285+00	0	1	healthy
4017	5	2026-06-24 10:51:32.948285+00	0	1	healthy
4018	2	2026-06-24 10:51:32.948285+00	0	1	healthy
4019	3	2026-06-24 10:51:32.948285+00	0	1	healthy
4020	4	2026-06-24 10:51:32.948285+00	0	1	healthy
4021	1	2026-06-24 10:52:32.840364+00	0	1	healthy
4022	5	2026-06-24 10:52:32.840364+00	0	1	healthy
4023	2	2026-06-24 10:52:32.840364+00	0	1	healthy
4024	3	2026-06-24 10:52:32.840364+00	0	1	healthy
4025	4	2026-06-24 10:52:32.840364+00	0	1	healthy
4026	1	2026-06-24 10:54:14.209263+00	0	1	healthy
4027	5	2026-06-24 10:54:14.209263+00	0	1	healthy
4028	2	2026-06-24 10:54:14.209263+00	0	1	healthy
4029	3	2026-06-24 10:54:14.209263+00	0	1	healthy
4030	4	2026-06-24 10:54:14.209263+00	0	1	healthy
4031	1	2026-06-24 10:55:14.18466+00	0	1	healthy
4032	5	2026-06-24 10:55:14.18466+00	0	1	healthy
4033	2	2026-06-24 10:55:14.18466+00	0	1	healthy
4034	3	2026-06-24 10:55:14.18466+00	0	1	healthy
4035	4	2026-06-24 10:55:14.18466+00	0	1	healthy
4036	1	2026-06-24 10:56:14.185519+00	0	1	healthy
4037	5	2026-06-24 10:56:14.185519+00	0	1	healthy
4038	2	2026-06-24 10:56:14.185519+00	0	1	healthy
4039	3	2026-06-24 10:56:14.185519+00	0	1	healthy
4040	4	2026-06-24 10:56:14.185519+00	0	1	healthy
4041	1	2026-06-24 10:57:14.186979+00	0	1	healthy
4042	5	2026-06-24 10:57:14.186979+00	0	1	healthy
4043	2	2026-06-24 10:57:14.186979+00	0	1	healthy
4044	3	2026-06-24 10:57:14.186979+00	0	1	healthy
4045	4	2026-06-24 10:57:14.186979+00	0	1	healthy
4046	1	2026-06-24 10:58:14.187754+00	0	1	healthy
4047	5	2026-06-24 10:58:14.187754+00	0	1	healthy
4048	2	2026-06-24 10:58:14.187754+00	0	1	healthy
4049	3	2026-06-24 10:58:14.187754+00	0	1	healthy
4050	4	2026-06-24 10:58:14.187754+00	0	1	healthy
4051	1	2026-06-24 10:59:14.18565+00	0	1	healthy
4052	5	2026-06-24 10:59:14.18565+00	0	1	healthy
4053	2	2026-06-24 10:59:14.18565+00	0	1	healthy
4054	3	2026-06-24 10:59:14.18565+00	0	1	healthy
4055	4	2026-06-24 10:59:14.18565+00	0	1	healthy
4056	1	2026-06-24 11:00:14.184678+00	0	1	healthy
4057	5	2026-06-24 11:00:14.184678+00	0	1	healthy
4058	2	2026-06-24 11:00:14.184678+00	0	1	healthy
4059	3	2026-06-24 11:00:14.184678+00	0	1	healthy
4060	4	2026-06-24 11:00:14.184678+00	0	1	healthy
4061	1	2026-06-24 11:01:14.185199+00	0	1	healthy
4062	5	2026-06-24 11:01:14.185199+00	0	1	healthy
4063	2	2026-06-24 11:01:14.185199+00	0	1	healthy
4064	3	2026-06-24 11:01:14.185199+00	0	1	healthy
4065	4	2026-06-24 11:01:14.185199+00	0	1	healthy
4066	1	2026-06-24 11:02:14.186644+00	0	1	healthy
4067	5	2026-06-24 11:02:14.186644+00	0	1	healthy
4068	2	2026-06-24 11:02:14.186644+00	0	1	healthy
4069	3	2026-06-24 11:02:14.186644+00	0	1	healthy
4070	4	2026-06-24 11:02:14.186644+00	0	1	healthy
4071	1	2026-06-24 11:03:14.310796+00	0	1	healthy
4072	5	2026-06-24 11:03:14.310796+00	0	1	healthy
4073	2	2026-06-24 11:03:14.310796+00	0	1	healthy
4074	3	2026-06-24 11:03:14.310796+00	0	1	healthy
4075	4	2026-06-24 11:03:14.310796+00	0	1	healthy
4076	1	2026-06-24 11:04:14.185721+00	0	1	healthy
4077	5	2026-06-24 11:04:14.185721+00	0	1	healthy
4078	2	2026-06-24 11:04:14.185721+00	0	1	healthy
4079	3	2026-06-24 11:04:14.185721+00	0	1	healthy
4080	4	2026-06-24 11:04:14.185721+00	0	1	healthy
4081	1	2026-06-24 11:05:14.186151+00	0	1	healthy
4082	5	2026-06-24 11:05:14.186151+00	0	1	healthy
4083	2	2026-06-24 11:05:14.186151+00	0	1	healthy
4084	3	2026-06-24 11:05:14.186151+00	0	1	healthy
4085	4	2026-06-24 11:05:14.186151+00	0	1	healthy
4086	1	2026-06-24 11:06:14.186628+00	0	1	healthy
4087	5	2026-06-24 11:06:14.186628+00	0	1	healthy
4088	2	2026-06-24 11:06:14.186628+00	0	1	healthy
4089	3	2026-06-24 11:06:14.186628+00	0	1	healthy
4090	4	2026-06-24 11:06:14.186628+00	0	1	healthy
4091	1	2026-06-24 11:07:14.187698+00	0	1	healthy
4092	5	2026-06-24 11:07:14.187698+00	0	1	healthy
4093	2	2026-06-24 11:07:14.187698+00	0	1	healthy
4094	3	2026-06-24 11:07:14.187698+00	0	1	healthy
4095	4	2026-06-24 11:07:14.187698+00	0	1	healthy
4096	1	2026-06-24 11:38:14.192068+00	0	1	healthy
4097	5	2026-06-24 11:38:14.192068+00	0	1	healthy
4098	2	2026-06-24 11:38:14.192068+00	0	1	healthy
4099	3	2026-06-24 11:38:14.192068+00	0	1	healthy
4100	4	2026-06-24 11:38:14.192068+00	0	1	healthy
4101	1	2026-06-24 11:39:14.189236+00	0	1	healthy
4102	5	2026-06-24 11:39:14.189236+00	0	1	healthy
4103	2	2026-06-24 11:39:14.189236+00	0	1	healthy
4104	3	2026-06-24 11:39:14.189236+00	0	1	healthy
4105	4	2026-06-24 11:39:14.189236+00	0	1	healthy
4106	1	2026-06-24 11:40:14.18885+00	0	1	healthy
4107	5	2026-06-24 11:40:14.18885+00	0	1	healthy
4108	2	2026-06-24 11:40:14.18885+00	0	1	healthy
4109	3	2026-06-24 11:40:14.18885+00	0	1	healthy
4110	4	2026-06-24 11:40:14.18885+00	0	1	healthy
4111	1	2026-06-24 11:41:14.188247+00	0	1	healthy
4112	5	2026-06-24 11:41:14.188247+00	0	1	healthy
4113	2	2026-06-24 11:41:14.188247+00	0	1	healthy
4114	3	2026-06-24 11:41:14.188247+00	0	1	healthy
4115	4	2026-06-24 11:41:14.188247+00	0	1	healthy
4116	1	2026-06-24 11:42:14.187412+00	0	1	healthy
4117	5	2026-06-24 11:42:14.187412+00	0	1	healthy
4118	2	2026-06-24 11:42:14.187412+00	0	1	healthy
4119	3	2026-06-24 11:42:14.187412+00	0	1	healthy
4120	4	2026-06-24 11:42:14.187412+00	0	1	healthy
4121	1	2026-06-24 11:43:14.190827+00	0	1	healthy
4122	5	2026-06-24 11:43:14.190827+00	0	1	healthy
4123	2	2026-06-24 11:43:14.190827+00	0	1	healthy
4124	3	2026-06-24 11:43:14.190827+00	0	1	healthy
4125	4	2026-06-24 11:43:14.190827+00	0	1	healthy
4126	1	2026-06-24 11:44:14.187442+00	0	1	healthy
4127	5	2026-06-24 11:44:14.187442+00	0	1	healthy
4128	2	2026-06-24 11:44:14.187442+00	0	1	healthy
4129	3	2026-06-24 11:44:14.187442+00	0	1	healthy
4130	4	2026-06-24 11:44:14.187442+00	0	1	healthy
4151	1	2026-06-24 12:24:14.186884+00	0	1	healthy
4152	5	2026-06-24 12:24:14.186884+00	0	1	healthy
4153	2	2026-06-24 12:24:14.186884+00	0	1	healthy
4154	3	2026-06-24 12:24:14.186884+00	0	1	healthy
4155	4	2026-06-24 12:24:14.186884+00	0	1	healthy
4181	1	2026-06-24 15:29:14.189612+00	0	1	healthy
4182	5	2026-06-24 15:29:14.189612+00	0	1	healthy
4183	2	2026-06-24 15:29:14.189612+00	0	1	healthy
4184	3	2026-06-24 15:29:14.189612+00	0	1	healthy
4185	4	2026-06-24 15:29:14.189612+00	0	1	healthy
6734	1	2026-06-25 17:20:43.267109+00	0	1	healthy
6735	5	2026-06-25 17:20:43.267109+00	0	1	healthy
6736	2	2026-06-25 17:20:43.267109+00	0	1	healthy
6737	3	2026-06-25 17:20:43.267109+00	0	1	healthy
6738	4	2026-06-25 17:20:43.267109+00	0	1	healthy
6769	1	2026-06-25 17:27:43.265902+00	0	1	healthy
6770	5	2026-06-25 17:27:43.265902+00	0	1	healthy
6771	2	2026-06-25 17:27:43.265902+00	0	1	healthy
6772	3	2026-06-25 17:27:43.265902+00	0	1	healthy
6773	4	2026-06-25 17:27:43.265902+00	0	1	healthy
6804	1	2026-06-25 17:34:43.266185+00	0	1	healthy
6805	5	2026-06-25 17:34:43.266185+00	0	1	healthy
6806	2	2026-06-25 17:34:43.266185+00	0	1	healthy
6807	3	2026-06-25 17:34:43.266185+00	0	1	healthy
6808	4	2026-06-25 17:34:43.266185+00	0	1	healthy
6824	1	2026-06-25 17:38:43.265499+00	0	1	healthy
6825	5	2026-06-25 17:38:43.265499+00	0	1	healthy
6826	2	2026-06-25 17:38:43.265499+00	0	1	healthy
6827	3	2026-06-25 17:38:43.265499+00	0	1	healthy
6828	4	2026-06-25 17:38:43.265499+00	0	1	healthy
6854	1	2026-06-25 18:14:43.266408+00	0	1	healthy
6855	5	2026-06-25 18:14:43.266408+00	0	1	healthy
6856	2	2026-06-25 18:14:43.266408+00	0	1	healthy
6857	3	2026-06-25 18:14:43.266408+00	0	1	healthy
6858	4	2026-06-25 18:14:43.266408+00	0	1	healthy
6874	1	2026-06-25 18:18:43.265702+00	0	1	healthy
6875	5	2026-06-25 18:18:43.265702+00	0	1	healthy
6876	2	2026-06-25 18:18:43.265702+00	0	1	healthy
6877	3	2026-06-25 18:18:43.265702+00	0	1	healthy
6878	4	2026-06-25 18:18:43.265702+00	0	1	healthy
6884	1	2026-06-25 18:20:43.265654+00	0	1	healthy
6885	5	2026-06-25 18:20:43.265654+00	0	1	healthy
6886	2	2026-06-25 18:20:43.265654+00	0	1	healthy
6887	3	2026-06-25 18:20:43.265654+00	0	1	healthy
6888	4	2026-06-25 18:20:43.265654+00	0	1	healthy
6919	1	2026-06-25 19:30:43.267447+00	0	1	healthy
6920	5	2026-06-25 19:30:43.267447+00	0	1	healthy
6921	2	2026-06-25 19:30:43.267447+00	0	1	healthy
6922	3	2026-06-25 19:30:43.267447+00	0	1	healthy
6923	4	2026-06-25 19:30:43.267447+00	0	1	healthy
6929	1	2026-06-25 21:07:43.268347+00	0	1	healthy
6930	5	2026-06-25 21:07:43.268347+00	0	1	healthy
6931	2	2026-06-25 21:07:43.268347+00	0	1	healthy
6932	3	2026-06-25 21:07:43.268347+00	0	1	healthy
6933	4	2026-06-25 21:07:43.268347+00	0	1	healthy
6969	1	2026-06-26 01:26:43.266632+00	0	1	healthy
6970	5	2026-06-26 01:26:43.266632+00	0	1	healthy
6971	2	2026-06-26 01:26:43.266632+00	0	1	healthy
6972	3	2026-06-26 01:26:43.266632+00	0	1	healthy
6973	4	2026-06-26 01:26:43.266632+00	0	1	healthy
7024	1	2026-06-26 01:51:43.265332+00	0	1	healthy
7025	5	2026-06-26 01:51:43.265332+00	0	1	healthy
7026	2	2026-06-26 01:51:43.265332+00	0	1	healthy
7027	3	2026-06-26 01:51:43.265332+00	0	1	healthy
7028	4	2026-06-26 01:51:43.265332+00	0	1	healthy
7079	1	2026-06-26 02:08:43.264348+00	0	1	healthy
7080	5	2026-06-26 02:08:43.264348+00	0	1	healthy
7081	2	2026-06-26 02:08:43.264348+00	0	1	healthy
7082	3	2026-06-26 02:08:43.264348+00	0	1	healthy
7083	4	2026-06-26 02:08:43.264348+00	0	1	healthy
7529	1	2026-06-26 10:36:57.232845+00	0	1	healthy
7530	5	2026-06-26 10:36:57.232845+00	0	1	healthy
7531	2	2026-06-26 10:36:57.232845+00	0	1	healthy
7532	3	2026-06-26 10:36:57.232845+00	0	1	healthy
7533	4	2026-06-26 10:36:57.232845+00	0	1	healthy
7534	1	2026-06-26 10:51:57.232723+00	0	1	healthy
7535	5	2026-06-26 10:51:57.232723+00	0	1	healthy
7536	2	2026-06-26 10:51:57.232723+00	0	1	healthy
7537	3	2026-06-26 10:51:57.232723+00	0	1	healthy
7538	4	2026-06-26 10:51:57.232723+00	0	1	healthy
4131	1	2026-06-24 11:45:14.188142+00	0	1	healthy
4132	5	2026-06-24 11:45:14.188142+00	0	1	healthy
4133	2	2026-06-24 11:45:14.188142+00	0	1	healthy
4134	3	2026-06-24 11:45:14.188142+00	0	1	healthy
4135	4	2026-06-24 11:45:14.188142+00	0	1	healthy
4156	1	2026-06-24 12:25:14.187241+00	0	1	healthy
4157	5	2026-06-24 12:25:14.187241+00	0	1	healthy
4158	2	2026-06-24 12:25:14.187241+00	0	1	healthy
4159	3	2026-06-24 12:25:14.187241+00	0	1	healthy
4160	4	2026-06-24 12:25:14.187241+00	0	1	healthy
4171	1	2026-06-24 14:18:14.187218+00	0	1	healthy
4172	5	2026-06-24 14:18:14.187218+00	0	1	healthy
4173	2	2026-06-24 14:18:14.187218+00	0	1	healthy
4174	3	2026-06-24 14:18:14.187218+00	0	1	healthy
4175	4	2026-06-24 14:18:14.187218+00	0	1	healthy
4191	1	2026-06-24 16:42:14.188319+00	0	1	healthy
4192	5	2026-06-24 16:42:14.188319+00	0	1	healthy
4193	2	2026-06-24 16:42:14.188319+00	0	1	healthy
4194	3	2026-06-24 16:42:14.188319+00	0	1	healthy
4195	4	2026-06-24 16:42:14.188319+00	0	1	healthy
6879	1	2026-06-25 18:19:43.267549+00	0	1	healthy
6880	5	2026-06-25 18:19:43.267549+00	0	1	healthy
6881	2	2026-06-25 18:19:43.267549+00	0	1	healthy
6882	3	2026-06-25 18:19:43.267549+00	0	1	healthy
6883	4	2026-06-25 18:19:43.267549+00	0	1	healthy
6899	1	2026-06-25 18:23:43.265554+00	0	1	healthy
6900	5	2026-06-25 18:23:43.265554+00	0	1	healthy
6901	2	2026-06-25 18:23:43.265554+00	0	1	healthy
6902	3	2026-06-25 18:23:43.265554+00	0	1	healthy
6903	4	2026-06-25 18:23:43.265554+00	0	1	healthy
6914	1	2026-06-25 18:53:43.267767+00	0	1	healthy
6915	5	2026-06-25 18:53:43.267767+00	0	1	healthy
6916	2	2026-06-25 18:53:43.267767+00	0	1	healthy
6917	3	2026-06-25 18:53:43.267767+00	0	1	healthy
6918	4	2026-06-25 18:53:43.267767+00	0	1	healthy
6949	1	2026-06-25 23:56:43.267855+00	0	1	healthy
6950	5	2026-06-25 23:56:43.267855+00	0	1	healthy
6951	2	2026-06-25 23:56:43.267855+00	0	1	healthy
6952	3	2026-06-25 23:56:43.267855+00	0	1	healthy
6953	4	2026-06-25 23:56:43.267855+00	0	1	healthy
6984	1	2026-06-26 01:43:43.265291+00	0	1	healthy
6985	5	2026-06-26 01:43:43.265291+00	0	1	healthy
6986	2	2026-06-26 01:43:43.265291+00	0	1	healthy
6987	3	2026-06-26 01:43:43.265291+00	0	1	healthy
6988	4	2026-06-26 01:43:43.265291+00	0	1	healthy
6989	1	2026-06-26 01:44:43.265767+00	0	1	healthy
6990	5	2026-06-26 01:44:43.265767+00	0	1	healthy
6991	2	2026-06-26 01:44:43.265767+00	0	1	healthy
6992	3	2026-06-26 01:44:43.265767+00	0	1	healthy
6993	4	2026-06-26 01:44:43.265767+00	0	1	healthy
7029	1	2026-06-26 01:52:43.264399+00	0	1	healthy
7030	5	2026-06-26 01:52:43.264399+00	0	1	healthy
7031	2	2026-06-26 01:52:43.264399+00	0	1	healthy
7032	3	2026-06-26 01:52:43.264399+00	0	1	healthy
7033	4	2026-06-26 01:52:43.264399+00	0	1	healthy
7044	1	2026-06-26 01:55:43.265584+00	0	1	healthy
7045	5	2026-06-26 01:55:43.265584+00	0	1	healthy
7046	2	2026-06-26 01:55:43.265584+00	0	1	healthy
7047	3	2026-06-26 01:55:43.265584+00	0	1	healthy
7048	4	2026-06-26 01:55:43.265584+00	0	1	healthy
7064	1	2026-06-26 02:05:43.264538+00	0	1	healthy
7065	5	2026-06-26 02:05:43.264538+00	0	1	healthy
7066	2	2026-06-26 02:05:43.264538+00	0	1	healthy
7067	3	2026-06-26 02:05:43.264538+00	0	1	healthy
7068	4	2026-06-26 02:05:43.264538+00	0	1	healthy
7084	1	2026-06-26 02:09:43.267749+00	0	1	healthy
7085	5	2026-06-26 02:09:43.267749+00	0	1	healthy
7086	2	2026-06-26 02:09:43.267749+00	0	1	healthy
7087	3	2026-06-26 02:09:43.267749+00	0	1	healthy
7088	4	2026-06-26 02:09:43.267749+00	0	1	healthy
7099	1	2026-06-26 02:12:43.265687+00	0	1	healthy
7100	5	2026-06-26 02:12:43.265687+00	0	1	healthy
7101	2	2026-06-26 02:12:43.265687+00	0	1	healthy
7102	3	2026-06-26 02:12:43.265687+00	0	1	healthy
7103	4	2026-06-26 02:12:43.265687+00	0	1	healthy
7539	1	2026-06-29 02:31:52.623635+00	0	1	healthy
7540	5	2026-06-29 02:31:52.623635+00	0	1	healthy
7541	2	2026-06-29 02:31:52.623635+00	0	1	healthy
7542	3	2026-06-29 02:31:52.623635+00	0	1	healthy
7543	4	2026-06-29 02:31:52.623635+00	0	1	healthy
7544	1	2026-06-29 02:46:52.633709+00	0	1	healthy
7545	5	2026-06-29 02:46:52.633709+00	0	1	healthy
7546	2	2026-06-29 02:46:52.633709+00	0	1	healthy
7547	3	2026-06-29 02:46:52.633709+00	0	1	healthy
7548	4	2026-06-29 02:46:52.633709+00	0	1	healthy
7549	1	2026-06-29 03:01:52.629959+00	0	1	healthy
7550	5	2026-06-29 03:01:52.629959+00	0	1	healthy
7551	2	2026-06-29 03:01:52.629959+00	0	1	healthy
7552	3	2026-06-29 03:01:52.629959+00	0	1	healthy
7553	4	2026-06-29 03:01:52.629959+00	0	1	healthy
7554	1	2026-06-29 03:16:52.6411+00	0	1	healthy
7555	5	2026-06-29 03:16:52.6411+00	0	1	healthy
7556	2	2026-06-29 03:16:52.6411+00	0	1	healthy
7557	3	2026-06-29 03:16:52.6411+00	0	1	healthy
7558	4	2026-06-29 03:16:52.6411+00	0	1	healthy
7674	1	2026-06-29 09:16:52.622359+00	0	1	healthy
7675	5	2026-06-29 09:16:52.622359+00	0	1	healthy
7676	2	2026-06-29 09:16:52.622359+00	0	1	healthy
7677	3	2026-06-29 09:16:52.622359+00	0	1	healthy
7678	4	2026-06-29 09:16:52.622359+00	0	1	healthy
7679	1	2026-06-29 10:24:54.314745+00	0	1	healthy
7680	5	2026-06-29 10:24:54.314745+00	0	1	healthy
7681	2	2026-06-29 10:24:54.314745+00	0	1	healthy
7682	3	2026-06-29 10:24:54.314745+00	0	1	healthy
7683	4	2026-06-29 10:24:54.314745+00	0	1	healthy
7684	1	2026-06-29 10:39:54.313995+00	0	1	healthy
7685	5	2026-06-29 10:39:54.313995+00	0	1	healthy
7686	2	2026-06-29 10:39:54.313995+00	0	1	healthy
7687	3	2026-06-29 10:39:54.313995+00	0	1	healthy
7688	4	2026-06-29 10:39:54.313995+00	0	1	healthy
4136	1	2026-06-24 11:46:14.186543+00	0	1	healthy
4137	5	2026-06-24 11:46:14.186543+00	0	1	healthy
4138	2	2026-06-24 11:46:14.186543+00	0	1	healthy
4139	3	2026-06-24 11:46:14.186543+00	0	1	healthy
4140	4	2026-06-24 11:46:14.186543+00	0	1	healthy
4161	1	2026-06-24 12:44:14.188715+00	0	1	healthy
4162	5	2026-06-24 12:44:14.188715+00	0	1	healthy
4163	2	2026-06-24 12:44:14.188715+00	0	1	healthy
4164	3	2026-06-24 12:44:14.188715+00	0	1	healthy
4165	4	2026-06-24 12:44:14.188715+00	0	1	healthy
4186	1	2026-06-24 16:05:14.189657+00	0	1	healthy
4187	5	2026-06-24 16:05:14.189657+00	0	1	healthy
4188	2	2026-06-24 16:05:14.189657+00	0	1	healthy
4189	3	2026-06-24 16:05:14.189657+00	0	1	healthy
4190	4	2026-06-24 16:05:14.189657+00	0	1	healthy
6954	1	2026-06-26 00:09:43.26792+00	0	1	healthy
6955	5	2026-06-26 00:09:43.26792+00	0	1	healthy
6956	2	2026-06-26 00:09:43.26792+00	0	1	healthy
6957	3	2026-06-26 00:09:43.26792+00	0	1	healthy
6958	4	2026-06-26 00:09:43.26792+00	0	1	healthy
6974	1	2026-06-26 01:41:43.266029+00	0	1	healthy
6975	5	2026-06-26 01:41:43.266029+00	0	1	healthy
6976	2	2026-06-26 01:41:43.266029+00	0	1	healthy
6977	3	2026-06-26 01:41:43.266029+00	0	1	healthy
6978	4	2026-06-26 01:41:43.266029+00	0	1	healthy
6999	1	2026-06-26 01:46:43.265632+00	0	1	healthy
7000	5	2026-06-26 01:46:43.265632+00	0	1	healthy
7001	2	2026-06-26 01:46:43.265632+00	0	1	healthy
7002	3	2026-06-26 01:46:43.265632+00	0	1	healthy
7003	4	2026-06-26 01:46:43.265632+00	0	1	healthy
7014	1	2026-06-26 01:49:43.266531+00	0	1	healthy
7015	5	2026-06-26 01:49:43.266531+00	0	1	healthy
7016	2	2026-06-26 01:49:43.266531+00	0	1	healthy
7017	3	2026-06-26 01:49:43.266531+00	0	1	healthy
7018	4	2026-06-26 01:49:43.266531+00	0	1	healthy
7034	1	2026-06-26 01:53:43.265178+00	0	1	healthy
7035	5	2026-06-26 01:53:43.265178+00	0	1	healthy
7036	2	2026-06-26 01:53:43.265178+00	0	1	healthy
7037	3	2026-06-26 01:53:43.265178+00	0	1	healthy
7038	4	2026-06-26 01:53:43.265178+00	0	1	healthy
7049	1	2026-06-26 02:02:43.265731+00	0	1	healthy
7050	5	2026-06-26 02:02:43.265731+00	0	1	healthy
7051	2	2026-06-26 02:02:43.265731+00	0	1	healthy
7052	3	2026-06-26 02:02:43.265731+00	0	1	healthy
7053	4	2026-06-26 02:02:43.265731+00	0	1	healthy
7559	1	2026-06-29 03:31:52.628814+00	0	1	healthy
7560	5	2026-06-29 03:31:52.628814+00	0	1	healthy
7561	2	2026-06-29 03:31:52.628814+00	0	1	healthy
7562	3	2026-06-29 03:31:52.628814+00	0	1	healthy
7563	4	2026-06-29 03:31:52.628814+00	0	1	healthy
7564	1	2026-06-29 03:46:52.639741+00	0	1	healthy
7565	5	2026-06-29 03:46:52.639741+00	0	1	healthy
7566	2	2026-06-29 03:46:52.639741+00	0	1	healthy
7567	3	2026-06-29 03:46:52.639741+00	0	1	healthy
7568	4	2026-06-29 03:46:52.639741+00	0	1	healthy
7579	1	2026-06-29 04:31:52.627292+00	0	1	healthy
7580	5	2026-06-29 04:31:52.627292+00	0	1	healthy
7581	2	2026-06-29 04:31:52.627292+00	0	1	healthy
7582	3	2026-06-29 04:31:52.627292+00	0	1	healthy
7583	4	2026-06-29 04:31:52.627292+00	0	1	healthy
7584	1	2026-06-29 04:46:52.63216+00	0	1	healthy
7585	5	2026-06-29 04:46:52.63216+00	0	1	healthy
7586	2	2026-06-29 04:46:52.63216+00	0	1	healthy
7587	3	2026-06-29 04:46:52.63216+00	0	1	healthy
7588	4	2026-06-29 04:46:52.63216+00	0	1	healthy
7639	1	2026-06-29 07:31:52.621696+00	0	1	healthy
7640	5	2026-06-29 07:31:52.621696+00	0	1	healthy
7641	2	2026-06-29 07:31:52.621696+00	0	1	healthy
7642	3	2026-06-29 07:31:52.621696+00	0	1	healthy
7643	4	2026-06-29 07:31:52.621696+00	0	1	healthy
7644	1	2026-06-29 07:46:52.65626+00	0	1	healthy
7645	5	2026-06-29 07:46:52.65626+00	0	1	healthy
7646	2	2026-06-29 07:46:52.65626+00	0	1	healthy
7647	3	2026-06-29 07:46:52.65626+00	0	1	healthy
7648	4	2026-06-29 07:46:52.65626+00	0	1	healthy
4141	1	2026-06-24 11:47:14.187154+00	0	1	healthy
4142	5	2026-06-24 11:47:14.187154+00	0	1	healthy
4143	2	2026-06-24 11:47:14.187154+00	0	1	healthy
4144	3	2026-06-24 11:47:14.187154+00	0	1	healthy
4145	4	2026-06-24 11:47:14.187154+00	0	1	healthy
4166	1	2026-06-24 13:08:14.186454+00	0	1	healthy
4167	5	2026-06-24 13:08:14.186454+00	0	1	healthy
4168	2	2026-06-24 13:08:14.186454+00	0	1	healthy
4169	3	2026-06-24 13:08:14.186454+00	0	1	healthy
4170	4	2026-06-24 13:08:14.186454+00	0	1	healthy
4176	1	2026-06-24 15:09:14.18905+00	0	1	healthy
4177	5	2026-06-24 15:09:14.18905+00	0	1	healthy
4178	2	2026-06-24 15:09:14.18905+00	0	1	healthy
4179	3	2026-06-24 15:09:14.18905+00	0	1	healthy
4180	4	2026-06-24 15:09:14.18905+00	0	1	healthy
6959	1	2026-06-26 00:42:43.267044+00	0	1	healthy
6960	5	2026-06-26 00:42:43.267044+00	0	1	healthy
6961	2	2026-06-26 00:42:43.267044+00	0	1	healthy
6962	3	2026-06-26 00:42:43.267044+00	0	1	healthy
6963	4	2026-06-26 00:42:43.267044+00	0	1	healthy
6979	1	2026-06-26 01:42:43.265541+00	0	1	healthy
6980	5	2026-06-26 01:42:43.265541+00	0	1	healthy
6981	2	2026-06-26 01:42:43.265541+00	0	1	healthy
6982	3	2026-06-26 01:42:43.265541+00	0	1	healthy
6983	4	2026-06-26 01:42:43.265541+00	0	1	healthy
6994	1	2026-06-26 01:45:43.265548+00	0	1	healthy
6995	5	2026-06-26 01:45:43.265548+00	0	1	healthy
6996	2	2026-06-26 01:45:43.265548+00	0	1	healthy
6997	3	2026-06-26 01:45:43.265548+00	0	1	healthy
6998	4	2026-06-26 01:45:43.265548+00	0	1	healthy
7004	1	2026-06-26 01:47:43.26665+00	0	1	healthy
7005	5	2026-06-26 01:47:43.26665+00	0	1	healthy
7006	2	2026-06-26 01:47:43.26665+00	0	1	healthy
7007	3	2026-06-26 01:47:43.26665+00	0	1	healthy
7008	4	2026-06-26 01:47:43.26665+00	0	1	healthy
7009	1	2026-06-26 01:48:43.265555+00	0	1	healthy
7010	5	2026-06-26 01:48:43.265555+00	0	1	healthy
7011	2	2026-06-26 01:48:43.265555+00	0	1	healthy
7012	3	2026-06-26 01:48:43.265555+00	0	1	healthy
7013	4	2026-06-26 01:48:43.265555+00	0	1	healthy
7039	1	2026-06-26 01:54:43.266604+00	0	1	healthy
7040	5	2026-06-26 01:54:43.266604+00	0	1	healthy
7041	2	2026-06-26 01:54:43.266604+00	0	1	healthy
7042	3	2026-06-26 01:54:43.266604+00	0	1	healthy
7043	4	2026-06-26 01:54:43.266604+00	0	1	healthy
7059	1	2026-06-26 02:04:43.265948+00	0	1	healthy
7060	5	2026-06-26 02:04:43.265948+00	0	1	healthy
7061	2	2026-06-26 02:04:43.265948+00	0	1	healthy
7062	3	2026-06-26 02:04:43.265948+00	0	1	healthy
7063	4	2026-06-26 02:04:43.265948+00	0	1	healthy
7069	1	2026-06-26 02:06:43.264389+00	0	1	healthy
7070	5	2026-06-26 02:06:43.264389+00	0	1	healthy
7071	2	2026-06-26 02:06:43.264389+00	0	1	healthy
7072	3	2026-06-26 02:06:43.264389+00	0	1	healthy
7073	4	2026-06-26 02:06:43.264389+00	0	1	healthy
7089	1	2026-06-26 02:10:43.265363+00	0	1	healthy
7090	5	2026-06-26 02:10:43.265363+00	0	1	healthy
7091	2	2026-06-26 02:10:43.265363+00	0	1	healthy
7092	3	2026-06-26 02:10:43.265363+00	0	1	healthy
7093	4	2026-06-26 02:10:43.265363+00	0	1	healthy
7569	1	2026-06-29 04:01:52.630696+00	0	1	healthy
7570	5	2026-06-29 04:01:52.630696+00	0	1	healthy
7571	2	2026-06-29 04:01:52.630696+00	0	1	healthy
7572	3	2026-06-29 04:01:52.630696+00	0	1	healthy
7573	4	2026-06-29 04:01:52.630696+00	0	1	healthy
7574	1	2026-06-29 04:16:52.624241+00	0	1	healthy
7575	5	2026-06-29 04:16:52.624241+00	0	1	healthy
7576	2	2026-06-29 04:16:52.624241+00	0	1	healthy
7577	3	2026-06-29 04:16:52.624241+00	0	1	healthy
7578	4	2026-06-29 04:16:52.624241+00	0	1	healthy
7589	1	2026-06-29 05:01:52.619165+00	0	1	healthy
7590	5	2026-06-29 05:01:52.619165+00	0	1	healthy
7591	2	2026-06-29 05:01:52.619165+00	0	1	healthy
7592	3	2026-06-29 05:01:52.619165+00	0	1	healthy
7593	4	2026-06-29 05:01:52.619165+00	0	1	healthy
7594	1	2026-06-29 05:16:52.625041+00	0	1	healthy
7595	5	2026-06-29 05:16:52.625041+00	0	1	healthy
7596	2	2026-06-29 05:16:52.625041+00	0	1	healthy
7597	3	2026-06-29 05:16:52.625041+00	0	1	healthy
7598	4	2026-06-29 05:16:52.625041+00	0	1	healthy
7609	1	2026-06-29 06:01:52.622452+00	0	1	healthy
7610	5	2026-06-29 06:01:52.622452+00	0	1	healthy
7611	2	2026-06-29 06:01:52.622452+00	0	1	healthy
7612	3	2026-06-29 06:01:52.622452+00	0	1	healthy
7613	4	2026-06-29 06:01:52.622452+00	0	1	healthy
7614	1	2026-06-29 06:16:52.624336+00	0	1	healthy
7615	5	2026-06-29 06:16:52.624336+00	0	1	healthy
7616	2	2026-06-29 06:16:52.624336+00	0	1	healthy
7617	3	2026-06-29 06:16:52.624336+00	0	1	healthy
7618	4	2026-06-29 06:16:52.624336+00	0	1	healthy
7629	1	2026-06-29 07:01:52.621214+00	0	1	healthy
7630	5	2026-06-29 07:01:52.621214+00	0	1	healthy
7631	2	2026-06-29 07:01:52.621214+00	0	1	healthy
7632	3	2026-06-29 07:01:52.621214+00	0	1	healthy
7633	4	2026-06-29 07:01:52.621214+00	0	1	healthy
7634	1	2026-06-29 07:16:52.622212+00	0	1	healthy
7635	5	2026-06-29 07:16:52.622212+00	0	1	healthy
7636	2	2026-06-29 07:16:52.622212+00	0	1	healthy
7637	3	2026-06-29 07:16:52.622212+00	0	1	healthy
7638	4	2026-06-29 07:16:52.622212+00	0	1	healthy
7659	1	2026-06-29 08:31:52.619779+00	0	1	healthy
7660	5	2026-06-29 08:31:52.619779+00	0	1	healthy
7661	2	2026-06-29 08:31:52.619779+00	0	1	healthy
7662	3	2026-06-29 08:31:52.619779+00	0	1	healthy
7663	4	2026-06-29 08:31:52.619779+00	0	1	healthy
7669	1	2026-06-29 09:01:52.620962+00	0	1	healthy
7670	5	2026-06-29 09:01:52.620962+00	0	1	healthy
7671	2	2026-06-29 09:01:52.620962+00	0	1	healthy
7672	3	2026-06-29 09:01:52.620962+00	0	1	healthy
7673	4	2026-06-29 09:01:52.620962+00	0	1	healthy
4146	1	2026-06-24 12:05:14.18647+00	0	1	healthy
4147	5	2026-06-24 12:05:14.18647+00	0	1	healthy
4148	2	2026-06-24 12:05:14.18647+00	0	1	healthy
4149	3	2026-06-24 12:05:14.18647+00	0	1	healthy
4150	4	2026-06-24 12:05:14.18647+00	0	1	healthy
4219	1	2026-06-25 02:40:43.266415+00	0	1	healthy
4220	5	2026-06-25 02:40:43.266415+00	0	1	healthy
4221	2	2026-06-25 02:40:43.266415+00	0	1	healthy
4222	3	2026-06-25 02:40:43.266415+00	0	1	healthy
4223	4	2026-06-25 02:40:43.266415+00	0	1	healthy
4224	1	2026-06-25 02:41:43.265989+00	0	1	healthy
4225	5	2026-06-25 02:41:43.265989+00	0	1	healthy
4226	2	2026-06-25 02:41:43.265989+00	0	1	healthy
4227	3	2026-06-25 02:41:43.265989+00	0	1	healthy
4228	4	2026-06-25 02:41:43.265989+00	0	1	healthy
4229	1	2026-06-25 02:42:43.264752+00	0	1	healthy
4230	5	2026-06-25 02:42:43.264752+00	0	1	healthy
4231	2	2026-06-25 02:42:43.264752+00	0	1	healthy
4232	3	2026-06-25 02:42:43.264752+00	0	1	healthy
4233	4	2026-06-25 02:42:43.264752+00	0	1	healthy
4234	1	2026-06-25 02:43:43.265421+00	0	1	healthy
4235	5	2026-06-25 02:43:43.265421+00	0	1	healthy
4236	2	2026-06-25 02:43:43.265421+00	0	1	healthy
4237	3	2026-06-25 02:43:43.265421+00	0	1	healthy
4238	4	2026-06-25 02:43:43.265421+00	0	1	healthy
4239	1	2026-06-25 02:44:43.268398+00	0	1	healthy
4240	5	2026-06-25 02:44:43.268398+00	0	1	healthy
4241	2	2026-06-25 02:44:43.268398+00	0	1	healthy
4242	3	2026-06-25 02:44:43.268398+00	0	1	healthy
4243	4	2026-06-25 02:44:43.268398+00	0	1	healthy
4244	1	2026-06-25 02:45:43.265634+00	0	1	healthy
4245	5	2026-06-25 02:45:43.265634+00	0	1	healthy
4246	2	2026-06-25 02:45:43.265634+00	0	1	healthy
4247	3	2026-06-25 02:45:43.265634+00	0	1	healthy
4248	4	2026-06-25 02:45:43.265634+00	0	1	healthy
4249	1	2026-06-25 02:46:43.264755+00	0	1	healthy
4250	5	2026-06-25 02:46:43.264755+00	0	1	healthy
4251	2	2026-06-25 02:46:43.264755+00	0	1	healthy
4252	3	2026-06-25 02:46:43.264755+00	0	1	healthy
4253	4	2026-06-25 02:46:43.264755+00	0	1	healthy
4254	1	2026-06-25 02:47:43.265416+00	0	1	healthy
4255	5	2026-06-25 02:47:43.265416+00	0	1	healthy
4256	2	2026-06-25 02:47:43.265416+00	0	1	healthy
4257	3	2026-06-25 02:47:43.265416+00	0	1	healthy
4258	4	2026-06-25 02:47:43.265416+00	0	1	healthy
4259	1	2026-06-25 02:48:43.265699+00	0	1	healthy
4260	5	2026-06-25 02:48:43.265699+00	0	1	healthy
4261	2	2026-06-25 02:48:43.265699+00	0	1	healthy
4262	3	2026-06-25 02:48:43.265699+00	0	1	healthy
4263	4	2026-06-25 02:48:43.265699+00	0	1	healthy
4264	1	2026-06-25 02:49:43.267545+00	0	1	healthy
4265	5	2026-06-25 02:49:43.267545+00	0	1	healthy
4266	2	2026-06-25 02:49:43.267545+00	0	1	healthy
4267	3	2026-06-25 02:49:43.267545+00	0	1	healthy
4268	4	2026-06-25 02:49:43.267545+00	0	1	healthy
4269	1	2026-06-25 02:50:43.265833+00	0	1	healthy
4270	5	2026-06-25 02:50:43.265833+00	0	1	healthy
4271	2	2026-06-25 02:50:43.265833+00	0	1	healthy
4272	3	2026-06-25 02:50:43.265833+00	0	1	healthy
4273	4	2026-06-25 02:50:43.265833+00	0	1	healthy
4274	1	2026-06-25 02:51:43.265468+00	0	1	healthy
4275	5	2026-06-25 02:51:43.265468+00	0	1	healthy
4276	2	2026-06-25 02:51:43.265468+00	0	1	healthy
4277	3	2026-06-25 02:51:43.265468+00	0	1	healthy
4278	4	2026-06-25 02:51:43.265468+00	0	1	healthy
4279	1	2026-06-25 02:52:43.266443+00	0	1	healthy
4280	5	2026-06-25 02:52:43.266443+00	0	1	healthy
4281	2	2026-06-25 02:52:43.266443+00	0	1	healthy
4282	3	2026-06-25 02:52:43.266443+00	0	1	healthy
4283	4	2026-06-25 02:52:43.266443+00	0	1	healthy
4284	1	2026-06-25 02:53:43.265299+00	0	1	healthy
4285	5	2026-06-25 02:53:43.265299+00	0	1	healthy
4286	2	2026-06-25 02:53:43.265299+00	0	1	healthy
4287	3	2026-06-25 02:53:43.265299+00	0	1	healthy
4288	4	2026-06-25 02:53:43.265299+00	0	1	healthy
4289	1	2026-06-25 02:54:43.327054+00	0	1	healthy
4290	5	2026-06-25 02:54:43.327054+00	0	1	healthy
4291	2	2026-06-25 02:54:43.327054+00	0	1	healthy
4292	3	2026-06-25 02:54:43.327054+00	0	1	healthy
4293	4	2026-06-25 02:54:43.327054+00	0	1	healthy
4294	1	2026-06-25 02:55:43.266235+00	0	1	healthy
4295	5	2026-06-25 02:55:43.266235+00	0	1	healthy
4296	2	2026-06-25 02:55:43.266235+00	0	1	healthy
4297	3	2026-06-25 02:55:43.266235+00	0	1	healthy
4298	4	2026-06-25 02:55:43.266235+00	0	1	healthy
4299	1	2026-06-25 02:56:43.267518+00	0	1	healthy
4300	5	2026-06-25 02:56:43.267518+00	0	1	healthy
4301	2	2026-06-25 02:56:43.267518+00	0	1	healthy
4302	3	2026-06-25 02:56:43.267518+00	0	1	healthy
4303	4	2026-06-25 02:56:43.267518+00	0	1	healthy
4304	1	2026-06-25 02:57:43.264568+00	0	1	healthy
4305	5	2026-06-25 02:57:43.264568+00	0	1	healthy
4306	2	2026-06-25 02:57:43.264568+00	0	1	healthy
4307	3	2026-06-25 02:57:43.264568+00	0	1	healthy
4308	4	2026-06-25 02:57:43.264568+00	0	1	healthy
4309	1	2026-06-25 02:58:43.264774+00	0	1	healthy
4310	5	2026-06-25 02:58:43.264774+00	0	1	healthy
4311	2	2026-06-25 02:58:43.264774+00	0	1	healthy
4312	3	2026-06-25 02:58:43.264774+00	0	1	healthy
4313	4	2026-06-25 02:58:43.264774+00	0	1	healthy
4314	1	2026-06-25 02:59:43.267628+00	0	1	healthy
4315	5	2026-06-25 02:59:43.267628+00	0	1	healthy
4316	2	2026-06-25 02:59:43.267628+00	0	1	healthy
4317	3	2026-06-25 02:59:43.267628+00	0	1	healthy
4318	4	2026-06-25 02:59:43.267628+00	0	1	healthy
4319	1	2026-06-25 03:00:43.266654+00	0	1	healthy
4320	5	2026-06-25 03:00:43.266654+00	0	1	healthy
4321	2	2026-06-25 03:00:43.266654+00	0	1	healthy
4322	3	2026-06-25 03:00:43.266654+00	0	1	healthy
4323	4	2026-06-25 03:00:43.266654+00	0	1	healthy
4324	1	2026-06-25 03:01:43.265902+00	0	1	healthy
4325	5	2026-06-25 03:01:43.265902+00	0	1	healthy
4326	2	2026-06-25 03:01:43.265902+00	0	1	healthy
4327	3	2026-06-25 03:01:43.265902+00	0	1	healthy
4328	4	2026-06-25 03:01:43.265902+00	0	1	healthy
4329	1	2026-06-25 03:02:43.266206+00	0	1	healthy
4330	5	2026-06-25 03:02:43.266206+00	0	1	healthy
4331	2	2026-06-25 03:02:43.266206+00	0	1	healthy
4332	3	2026-06-25 03:02:43.266206+00	0	1	healthy
4333	4	2026-06-25 03:02:43.266206+00	0	1	healthy
4334	1	2026-06-25 03:03:43.275373+00	0	1	healthy
4335	5	2026-06-25 03:03:43.275373+00	0	1	healthy
4336	2	2026-06-25 03:03:43.275373+00	0	1	healthy
4337	3	2026-06-25 03:03:43.275373+00	0	1	healthy
4338	4	2026-06-25 03:03:43.275373+00	0	1	healthy
4339	1	2026-06-25 03:04:43.267391+00	0	1	healthy
4340	5	2026-06-25 03:04:43.267391+00	0	1	healthy
4341	2	2026-06-25 03:04:43.267391+00	0	1	healthy
4342	3	2026-06-25 03:04:43.267391+00	0	1	healthy
4343	4	2026-06-25 03:04:43.267391+00	0	1	healthy
7104	1	2026-06-26 02:13:43.265606+00	0	1	healthy
7105	5	2026-06-26 02:13:43.265606+00	0	1	healthy
7106	2	2026-06-26 02:13:43.265606+00	0	1	healthy
7107	3	2026-06-26 02:13:43.265606+00	0	1	healthy
7108	4	2026-06-26 02:13:43.265606+00	0	1	healthy
7119	1	2026-06-26 02:16:43.266072+00	0	1	healthy
7120	5	2026-06-26 02:16:43.266072+00	0	1	healthy
7121	2	2026-06-26 02:16:43.266072+00	0	1	healthy
7122	3	2026-06-26 02:16:43.266072+00	0	1	healthy
7123	4	2026-06-26 02:16:43.266072+00	0	1	healthy
7599	1	2026-06-29 05:31:52.622389+00	0	1	healthy
7600	5	2026-06-29 05:31:52.622389+00	0	1	healthy
7601	2	2026-06-29 05:31:52.622389+00	0	1	healthy
7602	3	2026-06-29 05:31:52.622389+00	0	1	healthy
7603	4	2026-06-29 05:31:52.622389+00	0	1	healthy
7604	1	2026-06-29 05:46:52.622667+00	0	1	healthy
7605	5	2026-06-29 05:46:52.622667+00	0	1	healthy
7606	2	2026-06-29 05:46:52.622667+00	0	1	healthy
7607	3	2026-06-29 05:46:52.622667+00	0	1	healthy
7608	4	2026-06-29 05:46:52.622667+00	0	1	healthy
7619	1	2026-06-29 06:31:52.621473+00	0	1	healthy
7620	5	2026-06-29 06:31:52.621473+00	0	1	healthy
7621	2	2026-06-29 06:31:52.621473+00	0	1	healthy
7622	3	2026-06-29 06:31:52.621473+00	0	1	healthy
7623	4	2026-06-29 06:31:52.621473+00	0	1	healthy
7624	1	2026-06-29 06:46:52.623948+00	0	1	healthy
7625	5	2026-06-29 06:46:52.623948+00	0	1	healthy
7626	2	2026-06-29 06:46:52.623948+00	0	1	healthy
7627	3	2026-06-29 06:46:52.623948+00	0	1	healthy
7628	4	2026-06-29 06:46:52.623948+00	0	1	healthy
7649	1	2026-06-29 08:01:52.620619+00	0	1	healthy
7650	5	2026-06-29 08:01:52.620619+00	0	1	healthy
7651	2	2026-06-29 08:01:52.620619+00	0	1	healthy
7652	3	2026-06-29 08:01:52.620619+00	0	1	healthy
7653	4	2026-06-29 08:01:52.620619+00	0	1	healthy
4344	1	2026-06-25 03:05:43.264998+00	0	1	healthy
4345	5	2026-06-25 03:05:43.264998+00	0	1	healthy
4346	2	2026-06-25 03:05:43.264998+00	0	1	healthy
4347	3	2026-06-25 03:05:43.264998+00	0	1	healthy
4348	4	2026-06-25 03:05:43.264998+00	0	1	healthy
4349	1	2026-06-25 03:06:43.26544+00	0	1	healthy
4350	5	2026-06-25 03:06:43.26544+00	0	1	healthy
4351	2	2026-06-25 03:06:43.26544+00	0	1	healthy
4352	3	2026-06-25 03:06:43.26544+00	0	1	healthy
4353	4	2026-06-25 03:06:43.26544+00	0	1	healthy
4354	1	2026-06-25 03:07:43.300453+00	0	1	healthy
4355	5	2026-06-25 03:07:43.300453+00	0	1	healthy
4356	2	2026-06-25 03:07:43.300453+00	0	1	healthy
4357	3	2026-06-25 03:07:43.300453+00	0	1	healthy
4358	4	2026-06-25 03:07:43.300453+00	0	1	healthy
4359	1	2026-06-25 03:08:43.266016+00	0	1	healthy
4360	5	2026-06-25 03:08:43.266016+00	0	1	healthy
4361	2	2026-06-25 03:08:43.266016+00	0	1	healthy
4362	3	2026-06-25 03:08:43.266016+00	0	1	healthy
4363	4	2026-06-25 03:08:43.266016+00	0	1	healthy
4364	1	2026-06-25 03:09:43.267029+00	0	1	healthy
4365	5	2026-06-25 03:09:43.267029+00	0	1	healthy
4366	2	2026-06-25 03:09:43.267029+00	0	1	healthy
4367	3	2026-06-25 03:09:43.267029+00	0	1	healthy
4368	4	2026-06-25 03:09:43.267029+00	0	1	healthy
4369	1	2026-06-25 03:10:43.266146+00	0	1	healthy
4370	5	2026-06-25 03:10:43.266146+00	0	1	healthy
4371	2	2026-06-25 03:10:43.266146+00	0	1	healthy
4372	3	2026-06-25 03:10:43.266146+00	0	1	healthy
4373	4	2026-06-25 03:10:43.266146+00	0	1	healthy
4374	1	2026-06-25 03:11:43.265281+00	0	1	healthy
4375	5	2026-06-25 03:11:43.265281+00	0	1	healthy
4376	2	2026-06-25 03:11:43.265281+00	0	1	healthy
4377	3	2026-06-25 03:11:43.265281+00	0	1	healthy
4378	4	2026-06-25 03:11:43.265281+00	0	1	healthy
4379	1	2026-06-25 03:12:43.266006+00	0	1	healthy
4380	5	2026-06-25 03:12:43.266006+00	0	1	healthy
4381	2	2026-06-25 03:12:43.266006+00	0	1	healthy
4382	3	2026-06-25 03:12:43.266006+00	0	1	healthy
4383	4	2026-06-25 03:12:43.266006+00	0	1	healthy
4384	1	2026-06-25 03:13:43.265709+00	0	1	healthy
4385	5	2026-06-25 03:13:43.265709+00	0	1	healthy
4386	2	2026-06-25 03:13:43.265709+00	0	1	healthy
4387	3	2026-06-25 03:13:43.265709+00	0	1	healthy
4388	4	2026-06-25 03:13:43.265709+00	0	1	healthy
4389	1	2026-06-25 03:14:43.272427+00	0	1	healthy
4390	5	2026-06-25 03:14:43.272427+00	0	1	healthy
4391	2	2026-06-25 03:14:43.272427+00	0	1	healthy
4392	3	2026-06-25 03:14:43.272427+00	0	1	healthy
4393	4	2026-06-25 03:14:43.272427+00	0	1	healthy
4394	1	2026-06-25 03:15:43.267514+00	0	1	healthy
4395	5	2026-06-25 03:15:43.267514+00	0	1	healthy
4396	2	2026-06-25 03:15:43.267514+00	0	1	healthy
4397	3	2026-06-25 03:15:43.267514+00	0	1	healthy
4398	4	2026-06-25 03:15:43.267514+00	0	1	healthy
4399	1	2026-06-25 03:16:43.266181+00	0	1	healthy
4400	5	2026-06-25 03:16:43.266181+00	0	1	healthy
4401	2	2026-06-25 03:16:43.266181+00	0	1	healthy
4402	3	2026-06-25 03:16:43.266181+00	0	1	healthy
4403	4	2026-06-25 03:16:43.266181+00	0	1	healthy
4404	1	2026-06-25 03:17:43.265374+00	0	1	healthy
4405	5	2026-06-25 03:17:43.265374+00	0	1	healthy
4406	2	2026-06-25 03:17:43.265374+00	0	1	healthy
4407	3	2026-06-25 03:17:43.265374+00	0	1	healthy
4408	4	2026-06-25 03:17:43.265374+00	0	1	healthy
4409	1	2026-06-25 03:18:43.267038+00	0	1	healthy
4410	5	2026-06-25 03:18:43.267038+00	0	1	healthy
4411	2	2026-06-25 03:18:43.267038+00	0	1	healthy
4412	3	2026-06-25 03:18:43.267038+00	0	1	healthy
4413	4	2026-06-25 03:18:43.267038+00	0	1	healthy
4414	1	2026-06-25 03:19:43.282043+00	0	1	healthy
4415	5	2026-06-25 03:19:43.282043+00	0	1	healthy
4416	2	2026-06-25 03:19:43.282043+00	0	1	healthy
4417	3	2026-06-25 03:19:43.282043+00	0	1	healthy
4418	4	2026-06-25 03:19:43.282043+00	0	1	healthy
4419	1	2026-06-25 03:20:43.271455+00	0	1	healthy
4420	5	2026-06-25 03:20:43.271455+00	0	1	healthy
4421	2	2026-06-25 03:20:43.271455+00	0	1	healthy
4422	3	2026-06-25 03:20:43.271455+00	0	1	healthy
4423	4	2026-06-25 03:20:43.271455+00	0	1	healthy
4424	1	2026-06-25 03:21:43.265296+00	0	1	healthy
4425	5	2026-06-25 03:21:43.265296+00	0	1	healthy
4426	2	2026-06-25 03:21:43.265296+00	0	1	healthy
4427	3	2026-06-25 03:21:43.265296+00	0	1	healthy
4428	4	2026-06-25 03:21:43.265296+00	0	1	healthy
4429	1	2026-06-25 03:22:43.267234+00	0	1	healthy
4430	5	2026-06-25 03:22:43.267234+00	0	1	healthy
4431	2	2026-06-25 03:22:43.267234+00	0	1	healthy
4432	3	2026-06-25 03:22:43.267234+00	0	1	healthy
4433	4	2026-06-25 03:22:43.267234+00	0	1	healthy
4434	1	2026-06-25 03:23:43.266642+00	0	1	healthy
4435	5	2026-06-25 03:23:43.266642+00	0	1	healthy
4436	2	2026-06-25 03:23:43.266642+00	0	1	healthy
4437	3	2026-06-25 03:23:43.266642+00	0	1	healthy
4438	4	2026-06-25 03:23:43.266642+00	0	1	healthy
4439	1	2026-06-25 03:24:43.266727+00	0	1	healthy
4440	5	2026-06-25 03:24:43.266727+00	0	1	healthy
4441	2	2026-06-25 03:24:43.266727+00	0	1	healthy
4442	3	2026-06-25 03:24:43.266727+00	0	1	healthy
4443	4	2026-06-25 03:24:43.266727+00	0	1	healthy
4444	1	2026-06-25 03:25:43.352223+00	0	1	healthy
4445	5	2026-06-25 03:25:43.352223+00	0	1	healthy
4446	2	2026-06-25 03:25:43.352223+00	0	1	healthy
4447	3	2026-06-25 03:25:43.352223+00	0	1	healthy
4448	4	2026-06-25 03:25:43.352223+00	0	1	healthy
4449	1	2026-06-25 03:26:43.265672+00	0	1	healthy
4450	5	2026-06-25 03:26:43.265672+00	0	1	healthy
4451	2	2026-06-25 03:26:43.265672+00	0	1	healthy
4452	3	2026-06-25 03:26:43.265672+00	0	1	healthy
4453	4	2026-06-25 03:26:43.265672+00	0	1	healthy
4454	1	2026-06-25 03:27:43.264975+00	0	1	healthy
4455	5	2026-06-25 03:27:43.264975+00	0	1	healthy
4456	2	2026-06-25 03:27:43.264975+00	0	1	healthy
4457	3	2026-06-25 03:27:43.264975+00	0	1	healthy
4458	4	2026-06-25 03:27:43.264975+00	0	1	healthy
4459	1	2026-06-25 03:28:43.265901+00	0	1	healthy
4460	5	2026-06-25 03:28:43.265901+00	0	1	healthy
4461	2	2026-06-25 03:28:43.265901+00	0	1	healthy
4462	3	2026-06-25 03:28:43.265901+00	0	1	healthy
4463	4	2026-06-25 03:28:43.265901+00	0	1	healthy
4464	1	2026-06-25 03:29:43.299015+00	0	1	healthy
4465	5	2026-06-25 03:29:43.299015+00	0	1	healthy
4466	2	2026-06-25 03:29:43.299015+00	0	1	healthy
4467	3	2026-06-25 03:29:43.299015+00	0	1	healthy
4468	4	2026-06-25 03:29:43.299015+00	0	1	healthy
4469	1	2026-06-25 03:30:43.2655+00	0	1	healthy
4470	5	2026-06-25 03:30:43.2655+00	0	1	healthy
4471	2	2026-06-25 03:30:43.2655+00	0	1	healthy
4472	3	2026-06-25 03:30:43.2655+00	0	1	healthy
4473	4	2026-06-25 03:30:43.2655+00	0	1	healthy
4474	1	2026-06-25 03:31:43.267493+00	0	1	healthy
4475	5	2026-06-25 03:31:43.267493+00	0	1	healthy
4476	2	2026-06-25 03:31:43.267493+00	0	1	healthy
4477	3	2026-06-25 03:31:43.267493+00	0	1	healthy
4478	4	2026-06-25 03:31:43.267493+00	0	1	healthy
4479	1	2026-06-25 03:32:43.279897+00	0	1	healthy
4480	5	2026-06-25 03:32:43.279897+00	0	1	healthy
4481	2	2026-06-25 03:32:43.279897+00	0	1	healthy
4482	3	2026-06-25 03:32:43.279897+00	0	1	healthy
4483	4	2026-06-25 03:32:43.279897+00	0	1	healthy
4484	1	2026-06-25 03:33:43.266083+00	0	1	healthy
4485	5	2026-06-25 03:33:43.266083+00	0	1	healthy
4486	2	2026-06-25 03:33:43.266083+00	0	1	healthy
4487	3	2026-06-25 03:33:43.266083+00	0	1	healthy
4488	4	2026-06-25 03:33:43.266083+00	0	1	healthy
4489	1	2026-06-25 03:34:43.460783+00	0	1	healthy
4490	5	2026-06-25 03:34:43.460783+00	0	1	healthy
4491	2	2026-06-25 03:34:43.460783+00	0	1	healthy
4492	3	2026-06-25 03:34:43.460783+00	0	1	healthy
4493	4	2026-06-25 03:34:43.460783+00	0	1	healthy
4494	1	2026-06-25 03:35:43.26475+00	0	1	healthy
4495	5	2026-06-25 03:35:43.26475+00	0	1	healthy
4496	2	2026-06-25 03:35:43.26475+00	0	1	healthy
4497	3	2026-06-25 03:35:43.26475+00	0	1	healthy
4498	4	2026-06-25 03:35:43.26475+00	0	1	healthy
4499	1	2026-06-25 03:36:43.265075+00	0	1	healthy
4500	5	2026-06-25 03:36:43.265075+00	0	1	healthy
4501	2	2026-06-25 03:36:43.265075+00	0	1	healthy
4502	3	2026-06-25 03:36:43.265075+00	0	1	healthy
4503	4	2026-06-25 03:36:43.265075+00	0	1	healthy
4504	1	2026-06-25 03:37:43.265387+00	0	1	healthy
4505	5	2026-06-25 03:37:43.265387+00	0	1	healthy
4506	2	2026-06-25 03:37:43.265387+00	0	1	healthy
4507	3	2026-06-25 03:37:43.265387+00	0	1	healthy
4508	4	2026-06-25 03:37:43.265387+00	0	1	healthy
4509	1	2026-06-25 03:38:43.266918+00	0	1	healthy
4510	5	2026-06-25 03:38:43.266918+00	0	1	healthy
4511	2	2026-06-25 03:38:43.266918+00	0	1	healthy
4512	3	2026-06-25 03:38:43.266918+00	0	1	healthy
4513	4	2026-06-25 03:38:43.266918+00	0	1	healthy
4514	1	2026-06-25 03:39:43.272801+00	0	1	healthy
4515	5	2026-06-25 03:39:43.272801+00	0	1	healthy
4516	2	2026-06-25 03:39:43.272801+00	0	1	healthy
4517	3	2026-06-25 03:39:43.272801+00	0	1	healthy
4518	4	2026-06-25 03:39:43.272801+00	0	1	healthy
4519	1	2026-06-25 03:40:43.265652+00	0	1	healthy
4520	5	2026-06-25 03:40:43.265652+00	0	1	healthy
4521	2	2026-06-25 03:40:43.265652+00	0	1	healthy
4522	3	2026-06-25 03:40:43.265652+00	0	1	healthy
4523	4	2026-06-25 03:40:43.265652+00	0	1	healthy
4524	1	2026-06-25 03:41:43.39905+00	0	1	healthy
4525	5	2026-06-25 03:41:43.39905+00	0	1	healthy
4526	2	2026-06-25 03:41:43.39905+00	0	1	healthy
4527	3	2026-06-25 03:41:43.39905+00	0	1	healthy
4528	4	2026-06-25 03:41:43.39905+00	0	1	healthy
4529	1	2026-06-25 03:42:43.268329+00	0	1	healthy
4530	5	2026-06-25 03:42:43.268329+00	0	1	healthy
4531	2	2026-06-25 03:42:43.268329+00	0	1	healthy
4532	3	2026-06-25 03:42:43.268329+00	0	1	healthy
4533	4	2026-06-25 03:42:43.268329+00	0	1	healthy
4534	1	2026-06-25 03:43:43.308148+00	0	1	healthy
4535	5	2026-06-25 03:43:43.308148+00	0	1	healthy
4536	2	2026-06-25 03:43:43.308148+00	0	1	healthy
4537	3	2026-06-25 03:43:43.308148+00	0	1	healthy
4538	4	2026-06-25 03:43:43.308148+00	0	1	healthy
4539	1	2026-06-25 03:44:43.267298+00	0	1	healthy
4540	5	2026-06-25 03:44:43.267298+00	0	1	healthy
4541	2	2026-06-25 03:44:43.267298+00	0	1	healthy
4542	3	2026-06-25 03:44:43.267298+00	0	1	healthy
4543	4	2026-06-25 03:44:43.267298+00	0	1	healthy
4544	1	2026-06-25 03:45:43.366418+00	0	1	healthy
4545	5	2026-06-25 03:45:43.366418+00	0	1	healthy
4546	2	2026-06-25 03:45:43.366418+00	0	1	healthy
4547	3	2026-06-25 03:45:43.366418+00	0	1	healthy
4548	4	2026-06-25 03:45:43.366418+00	0	1	healthy
4549	1	2026-06-25 03:46:43.266166+00	0	1	healthy
4550	5	2026-06-25 03:46:43.266166+00	0	1	healthy
4551	2	2026-06-25 03:46:43.266166+00	0	1	healthy
4552	3	2026-06-25 03:46:43.266166+00	0	1	healthy
4553	4	2026-06-25 03:46:43.266166+00	0	1	healthy
4554	1	2026-06-25 03:47:43.270125+00	0	1	healthy
4555	5	2026-06-25 03:47:43.270125+00	0	1	healthy
4556	2	2026-06-25 03:47:43.270125+00	0	1	healthy
4557	3	2026-06-25 03:47:43.270125+00	0	1	healthy
4558	4	2026-06-25 03:47:43.270125+00	0	1	healthy
4559	1	2026-06-25 03:48:43.695217+00	0	1	healthy
4560	5	2026-06-25 03:48:43.695217+00	0	1	healthy
4561	2	2026-06-25 03:48:43.695217+00	0	1	healthy
4562	3	2026-06-25 03:48:43.695217+00	0	1	healthy
4563	4	2026-06-25 03:48:43.695217+00	0	1	healthy
4564	1	2026-06-25 03:49:43.267601+00	0	1	healthy
4565	5	2026-06-25 03:49:43.267601+00	0	1	healthy
4566	2	2026-06-25 03:49:43.267601+00	0	1	healthy
4567	3	2026-06-25 03:49:43.267601+00	0	1	healthy
4568	4	2026-06-25 03:49:43.267601+00	0	1	healthy
4569	1	2026-06-25 03:50:43.265402+00	0	1	healthy
4570	5	2026-06-25 03:50:43.265402+00	0	1	healthy
4571	2	2026-06-25 03:50:43.265402+00	0	1	healthy
4572	3	2026-06-25 03:50:43.265402+00	0	1	healthy
4573	4	2026-06-25 03:50:43.265402+00	0	1	healthy
4574	1	2026-06-25 03:51:43.274113+00	0	1	healthy
4575	5	2026-06-25 03:51:43.274113+00	0	1	healthy
4576	2	2026-06-25 03:51:43.274113+00	0	1	healthy
4577	3	2026-06-25 03:51:43.274113+00	0	1	healthy
4578	4	2026-06-25 03:51:43.274113+00	0	1	healthy
4579	1	2026-06-25 03:52:43.267288+00	0	1	healthy
4580	5	2026-06-25 03:52:43.267288+00	0	1	healthy
4581	2	2026-06-25 03:52:43.267288+00	0	1	healthy
4582	3	2026-06-25 03:52:43.267288+00	0	1	healthy
4583	4	2026-06-25 03:52:43.267288+00	0	1	healthy
4584	1	2026-06-25 03:53:43.265114+00	0	1	healthy
4585	5	2026-06-25 03:53:43.265114+00	0	1	healthy
4586	2	2026-06-25 03:53:43.265114+00	0	1	healthy
4587	3	2026-06-25 03:53:43.265114+00	0	1	healthy
4588	4	2026-06-25 03:53:43.265114+00	0	1	healthy
4589	1	2026-06-25 03:54:43.28543+00	0	1	healthy
4590	5	2026-06-25 03:54:43.28543+00	0	1	healthy
4591	2	2026-06-25 03:54:43.28543+00	0	1	healthy
4592	3	2026-06-25 03:54:43.28543+00	0	1	healthy
4593	4	2026-06-25 03:54:43.28543+00	0	1	healthy
4599	1	2026-06-25 03:56:43.314941+00	0	1	healthy
4600	5	2026-06-25 03:56:43.314941+00	0	1	healthy
4601	2	2026-06-25 03:56:43.314941+00	0	1	healthy
4602	3	2026-06-25 03:56:43.314941+00	0	1	healthy
4603	4	2026-06-25 03:56:43.314941+00	0	1	healthy
4609	1	2026-06-25 03:58:43.367212+00	0	1	healthy
4610	5	2026-06-25 03:58:43.367212+00	0	1	healthy
4611	2	2026-06-25 03:58:43.367212+00	0	1	healthy
4612	3	2026-06-25 03:58:43.367212+00	0	1	healthy
4613	4	2026-06-25 03:58:43.367212+00	0	1	healthy
7109	1	2026-06-26 02:14:43.267964+00	0	1	healthy
7110	5	2026-06-26 02:14:43.267964+00	0	1	healthy
7111	2	2026-06-26 02:14:43.267964+00	0	1	healthy
7112	3	2026-06-26 02:14:43.267964+00	0	1	healthy
7113	4	2026-06-26 02:14:43.267964+00	0	1	healthy
7654	1	2026-06-29 08:16:52.757005+00	0	1	healthy
7655	5	2026-06-29 08:16:52.757005+00	0	1	healthy
7656	2	2026-06-29 08:16:52.757005+00	0	1	healthy
7657	3	2026-06-29 08:16:52.757005+00	0	1	healthy
7658	4	2026-06-29 08:16:52.757005+00	0	1	healthy
4594	1	2026-06-25 03:55:43.266492+00	0	1	healthy
4595	5	2026-06-25 03:55:43.266492+00	0	1	healthy
4596	2	2026-06-25 03:55:43.266492+00	0	1	healthy
4597	3	2026-06-25 03:55:43.266492+00	0	1	healthy
4598	4	2026-06-25 03:55:43.266492+00	0	1	healthy
7114	1	2026-06-26 02:15:43.268941+00	0	1	healthy
7115	5	2026-06-26 02:15:43.268941+00	0	1	healthy
7116	2	2026-06-26 02:15:43.268941+00	0	1	healthy
7117	3	2026-06-26 02:15:43.268941+00	0	1	healthy
7118	4	2026-06-26 02:15:43.268941+00	0	1	healthy
7664	1	2026-06-29 08:46:52.67786+00	0	1	healthy
7665	5	2026-06-29 08:46:52.67786+00	0	1	healthy
7666	2	2026-06-29 08:46:52.67786+00	0	1	healthy
7667	3	2026-06-29 08:46:52.67786+00	0	1	healthy
7668	4	2026-06-29 08:46:52.67786+00	0	1	healthy
4604	1	2026-06-25 03:57:43.266094+00	0	1	healthy
4605	5	2026-06-25 03:57:43.266094+00	0	1	healthy
4606	2	2026-06-25 03:57:43.266094+00	0	1	healthy
4607	3	2026-06-25 03:57:43.266094+00	0	1	healthy
4608	4	2026-06-25 03:57:43.266094+00	0	1	healthy
4614	1	2026-06-25 03:59:43.272352+00	0	1	healthy
4615	5	2026-06-25 03:59:43.272352+00	0	1	healthy
4616	2	2026-06-25 03:59:43.272352+00	0	1	healthy
4617	3	2026-06-25 03:59:43.272352+00	0	1	healthy
4618	4	2026-06-25 03:59:43.272352+00	0	1	healthy
4619	1	2026-06-25 04:00:43.266758+00	0	1	healthy
4620	5	2026-06-25 04:00:43.266758+00	0	1	healthy
4621	2	2026-06-25 04:00:43.266758+00	0	1	healthy
4622	3	2026-06-25 04:00:43.266758+00	0	1	healthy
4623	4	2026-06-25 04:00:43.266758+00	0	1	healthy
4624	1	2026-06-25 04:01:43.267171+00	0	1	healthy
4625	5	2026-06-25 04:01:43.267171+00	0	1	healthy
4626	2	2026-06-25 04:01:43.267171+00	0	1	healthy
4627	3	2026-06-25 04:01:43.267171+00	0	1	healthy
4628	4	2026-06-25 04:01:43.267171+00	0	1	healthy
4629	1	2026-06-25 04:02:43.26447+00	0	1	healthy
4630	5	2026-06-25 04:02:43.26447+00	0	1	healthy
4631	2	2026-06-25 04:02:43.26447+00	0	1	healthy
4632	3	2026-06-25 04:02:43.26447+00	0	1	healthy
4633	4	2026-06-25 04:02:43.26447+00	0	1	healthy
4634	1	2026-06-25 04:03:43.27008+00	0	1	healthy
4635	5	2026-06-25 04:03:43.27008+00	0	1	healthy
4636	2	2026-06-25 04:03:43.27008+00	0	1	healthy
4637	3	2026-06-25 04:03:43.27008+00	0	1	healthy
4638	4	2026-06-25 04:03:43.27008+00	0	1	healthy
4639	1	2026-06-25 04:04:43.266518+00	0	1	healthy
4640	5	2026-06-25 04:04:43.266518+00	0	1	healthy
4641	2	2026-06-25 04:04:43.266518+00	0	1	healthy
4642	3	2026-06-25 04:04:43.266518+00	0	1	healthy
4643	4	2026-06-25 04:04:43.266518+00	0	1	healthy
4644	1	2026-06-25 04:05:43.265495+00	0	1	healthy
4645	5	2026-06-25 04:05:43.265495+00	0	1	healthy
4646	2	2026-06-25 04:05:43.265495+00	0	1	healthy
4647	3	2026-06-25 04:05:43.265495+00	0	1	healthy
4648	4	2026-06-25 04:05:43.265495+00	0	1	healthy
4649	1	2026-06-25 04:06:43.264306+00	0	1	healthy
4650	5	2026-06-25 04:06:43.264306+00	0	1	healthy
4651	2	2026-06-25 04:06:43.264306+00	0	1	healthy
4652	3	2026-06-25 04:06:43.264306+00	0	1	healthy
4653	4	2026-06-25 04:06:43.264306+00	0	1	healthy
4654	1	2026-06-25 04:07:43.265302+00	0	1	healthy
4655	5	2026-06-25 04:07:43.265302+00	0	1	healthy
4656	2	2026-06-25 04:07:43.265302+00	0	1	healthy
4657	3	2026-06-25 04:07:43.265302+00	0	1	healthy
4658	4	2026-06-25 04:07:43.265302+00	0	1	healthy
4659	1	2026-06-25 04:08:43.266479+00	0	1	healthy
4660	5	2026-06-25 04:08:43.266479+00	0	1	healthy
4661	2	2026-06-25 04:08:43.266479+00	0	1	healthy
4662	3	2026-06-25 04:08:43.266479+00	0	1	healthy
4663	4	2026-06-25 04:08:43.266479+00	0	1	healthy
4664	1	2026-06-25 04:09:43.266708+00	0	1	healthy
4665	5	2026-06-25 04:09:43.266708+00	0	1	healthy
4666	2	2026-06-25 04:09:43.266708+00	0	1	healthy
4667	3	2026-06-25 04:09:43.266708+00	0	1	healthy
4668	4	2026-06-25 04:09:43.266708+00	0	1	healthy
4669	1	2026-06-25 04:10:43.266963+00	0	1	healthy
4670	5	2026-06-25 04:10:43.266963+00	0	1	healthy
4671	2	2026-06-25 04:10:43.266963+00	0	1	healthy
4672	3	2026-06-25 04:10:43.266963+00	0	1	healthy
4673	4	2026-06-25 04:10:43.266963+00	0	1	healthy
4674	1	2026-06-25 04:11:43.275096+00	0	1	healthy
4675	5	2026-06-25 04:11:43.275096+00	0	1	healthy
4676	2	2026-06-25 04:11:43.275096+00	0	1	healthy
4677	3	2026-06-25 04:11:43.275096+00	0	1	healthy
4678	4	2026-06-25 04:11:43.275096+00	0	1	healthy
4679	1	2026-06-25 04:12:43.269238+00	0	1	healthy
4680	5	2026-06-25 04:12:43.269238+00	0	1	healthy
4681	2	2026-06-25 04:12:43.269238+00	0	1	healthy
4682	3	2026-06-25 04:12:43.269238+00	0	1	healthy
4683	4	2026-06-25 04:12:43.269238+00	0	1	healthy
4684	1	2026-06-25 04:13:43.265024+00	0	1	healthy
4685	5	2026-06-25 04:13:43.265024+00	0	1	healthy
4686	2	2026-06-25 04:13:43.265024+00	0	1	healthy
4687	3	2026-06-25 04:13:43.265024+00	0	1	healthy
4688	4	2026-06-25 04:13:43.265024+00	0	1	healthy
4689	1	2026-06-25 04:14:43.26698+00	0	1	healthy
4690	5	2026-06-25 04:14:43.26698+00	0	1	healthy
4691	2	2026-06-25 04:14:43.26698+00	0	1	healthy
4692	3	2026-06-25 04:14:43.26698+00	0	1	healthy
4693	4	2026-06-25 04:14:43.26698+00	0	1	healthy
4694	1	2026-06-25 04:15:43.264652+00	0	1	healthy
4695	5	2026-06-25 04:15:43.264652+00	0	1	healthy
4696	2	2026-06-25 04:15:43.264652+00	0	1	healthy
4697	3	2026-06-25 04:15:43.264652+00	0	1	healthy
4698	4	2026-06-25 04:15:43.264652+00	0	1	healthy
4699	1	2026-06-25 04:16:43.265384+00	0	1	healthy
4700	5	2026-06-25 04:16:43.265384+00	0	1	healthy
4701	2	2026-06-25 04:16:43.265384+00	0	1	healthy
4702	3	2026-06-25 04:16:43.265384+00	0	1	healthy
4703	4	2026-06-25 04:16:43.265384+00	0	1	healthy
4704	1	2026-06-25 04:17:43.265618+00	0	1	healthy
4705	5	2026-06-25 04:17:43.265618+00	0	1	healthy
4706	2	2026-06-25 04:17:43.265618+00	0	1	healthy
4707	3	2026-06-25 04:17:43.265618+00	0	1	healthy
4708	4	2026-06-25 04:17:43.265618+00	0	1	healthy
4709	1	2026-06-25 04:18:43.265583+00	0	1	healthy
4710	5	2026-06-25 04:18:43.265583+00	0	1	healthy
4711	2	2026-06-25 04:18:43.265583+00	0	1	healthy
4712	3	2026-06-25 04:18:43.265583+00	0	1	healthy
4713	4	2026-06-25 04:18:43.265583+00	0	1	healthy
4714	1	2026-06-25 04:19:43.270221+00	0	1	healthy
4715	5	2026-06-25 04:19:43.270221+00	0	1	healthy
4716	2	2026-06-25 04:19:43.270221+00	0	1	healthy
4717	3	2026-06-25 04:19:43.270221+00	0	1	healthy
4718	4	2026-06-25 04:19:43.270221+00	0	1	healthy
4719	1	2026-06-25 04:20:43.26567+00	0	1	healthy
4720	5	2026-06-25 04:20:43.26567+00	0	1	healthy
4721	2	2026-06-25 04:20:43.26567+00	0	1	healthy
4722	3	2026-06-25 04:20:43.26567+00	0	1	healthy
4723	4	2026-06-25 04:20:43.26567+00	0	1	healthy
4724	1	2026-06-25 04:21:43.266353+00	0	1	healthy
4725	5	2026-06-25 04:21:43.266353+00	0	1	healthy
4726	2	2026-06-25 04:21:43.266353+00	0	1	healthy
4727	3	2026-06-25 04:21:43.266353+00	0	1	healthy
4728	4	2026-06-25 04:21:43.266353+00	0	1	healthy
4729	1	2026-06-25 04:22:43.265497+00	0	1	healthy
4730	5	2026-06-25 04:22:43.265497+00	0	1	healthy
4731	2	2026-06-25 04:22:43.265497+00	0	1	healthy
4732	3	2026-06-25 04:22:43.265497+00	0	1	healthy
4733	4	2026-06-25 04:22:43.265497+00	0	1	healthy
4744	1	2026-06-25 04:25:43.2644+00	0	1	healthy
4745	5	2026-06-25 04:25:43.2644+00	0	1	healthy
4746	2	2026-06-25 04:25:43.2644+00	0	1	healthy
4747	3	2026-06-25 04:25:43.2644+00	0	1	healthy
4748	4	2026-06-25 04:25:43.2644+00	0	1	healthy
4764	1	2026-06-25 04:29:43.266592+00	0	1	healthy
4765	5	2026-06-25 04:29:43.266592+00	0	1	healthy
4766	2	2026-06-25 04:29:43.266592+00	0	1	healthy
4767	3	2026-06-25 04:29:43.266592+00	0	1	healthy
4768	4	2026-06-25 04:29:43.266592+00	0	1	healthy
4779	1	2026-06-25 04:32:43.264912+00	0	1	healthy
4780	5	2026-06-25 04:32:43.264912+00	0	1	healthy
4781	2	2026-06-25 04:32:43.264912+00	0	1	healthy
4782	3	2026-06-25 04:32:43.264912+00	0	1	healthy
4783	4	2026-06-25 04:32:43.264912+00	0	1	healthy
4794	1	2026-06-25 04:35:43.266047+00	0	1	healthy
4795	5	2026-06-25 04:35:43.266047+00	0	1	healthy
4796	2	2026-06-25 04:35:43.266047+00	0	1	healthy
4797	3	2026-06-25 04:35:43.266047+00	0	1	healthy
4798	4	2026-06-25 04:35:43.266047+00	0	1	healthy
7124	1	2026-06-26 02:17:43.265679+00	0	1	healthy
7125	5	2026-06-26 02:17:43.265679+00	0	1	healthy
7126	2	2026-06-26 02:17:43.265679+00	0	1	healthy
7127	3	2026-06-26 02:17:43.265679+00	0	1	healthy
7128	4	2026-06-26 02:17:43.265679+00	0	1	healthy
4734	1	2026-06-25 04:23:43.265519+00	0	1	healthy
4735	5	2026-06-25 04:23:43.265519+00	0	1	healthy
4736	2	2026-06-25 04:23:43.265519+00	0	1	healthy
4737	3	2026-06-25 04:23:43.265519+00	0	1	healthy
4738	4	2026-06-25 04:23:43.265519+00	0	1	healthy
4749	1	2026-06-25 04:26:43.355292+00	0	1	healthy
4750	5	2026-06-25 04:26:43.355292+00	0	1	healthy
4751	2	2026-06-25 04:26:43.355292+00	0	1	healthy
4752	3	2026-06-25 04:26:43.355292+00	0	1	healthy
4753	4	2026-06-25 04:26:43.355292+00	0	1	healthy
4774	1	2026-06-25 04:31:43.265266+00	0	1	healthy
4775	5	2026-06-25 04:31:43.265266+00	0	1	healthy
4776	2	2026-06-25 04:31:43.265266+00	0	1	healthy
4777	3	2026-06-25 04:31:43.265266+00	0	1	healthy
4778	4	2026-06-25 04:31:43.265266+00	0	1	healthy
4789	1	2026-06-25 04:34:43.266002+00	0	1	healthy
4790	5	2026-06-25 04:34:43.266002+00	0	1	healthy
4791	2	2026-06-25 04:34:43.266002+00	0	1	healthy
4792	3	2026-06-25 04:34:43.266002+00	0	1	healthy
4793	4	2026-06-25 04:34:43.266002+00	0	1	healthy
4809	1	2026-06-25 04:38:43.266551+00	0	1	healthy
4810	5	2026-06-25 04:38:43.266551+00	0	1	healthy
4811	2	2026-06-25 04:38:43.266551+00	0	1	healthy
4812	3	2026-06-25 04:38:43.266551+00	0	1	healthy
4813	4	2026-06-25 04:38:43.266551+00	0	1	healthy
7129	1	2026-06-26 02:18:43.264307+00	0	1	healthy
7130	5	2026-06-26 02:18:43.264307+00	0	1	healthy
7131	2	2026-06-26 02:18:43.264307+00	0	1	healthy
7132	3	2026-06-26 02:18:43.264307+00	0	1	healthy
7133	4	2026-06-26 02:18:43.264307+00	0	1	healthy
7134	1	2026-06-26 02:19:43.26663+00	0	1	healthy
7135	5	2026-06-26 02:19:43.26663+00	0	1	healthy
7136	2	2026-06-26 02:19:43.26663+00	0	1	healthy
7137	3	2026-06-26 02:19:43.26663+00	0	1	healthy
7138	4	2026-06-26 02:19:43.26663+00	0	1	healthy
7144	1	2026-06-26 02:21:43.265578+00	0	1	healthy
7145	5	2026-06-26 02:21:43.265578+00	0	1	healthy
7146	2	2026-06-26 02:21:43.265578+00	0	1	healthy
7147	3	2026-06-26 02:21:43.265578+00	0	1	healthy
7148	4	2026-06-26 02:21:43.265578+00	0	1	healthy
4739	1	2026-06-25 04:24:43.265308+00	0	1	healthy
4740	5	2026-06-25 04:24:43.265308+00	0	1	healthy
4741	2	2026-06-25 04:24:43.265308+00	0	1	healthy
4742	3	2026-06-25 04:24:43.265308+00	0	1	healthy
4743	4	2026-06-25 04:24:43.265308+00	0	1	healthy
4754	1	2026-06-25 04:27:43.266245+00	0	1	healthy
4755	5	2026-06-25 04:27:43.266245+00	0	1	healthy
4756	2	2026-06-25 04:27:43.266245+00	0	1	healthy
4757	3	2026-06-25 04:27:43.266245+00	0	1	healthy
4758	4	2026-06-25 04:27:43.266245+00	0	1	healthy
4799	1	2026-06-25 04:36:43.266153+00	0	1	healthy
4800	5	2026-06-25 04:36:43.266153+00	0	1	healthy
4801	2	2026-06-25 04:36:43.266153+00	0	1	healthy
4802	3	2026-06-25 04:36:43.266153+00	0	1	healthy
4803	4	2026-06-25 04:36:43.266153+00	0	1	healthy
4814	1	2026-06-25 04:39:43.266969+00	0	1	healthy
4815	5	2026-06-25 04:39:43.266969+00	0	1	healthy
4816	2	2026-06-25 04:39:43.266969+00	0	1	healthy
4817	3	2026-06-25 04:39:43.266969+00	0	1	healthy
4818	4	2026-06-25 04:39:43.266969+00	0	1	healthy
7139	1	2026-06-26 02:20:43.265979+00	0	1	healthy
7140	5	2026-06-26 02:20:43.265979+00	0	1	healthy
7141	2	2026-06-26 02:20:43.265979+00	0	1	healthy
7142	3	2026-06-26 02:20:43.265979+00	0	1	healthy
7143	4	2026-06-26 02:20:43.265979+00	0	1	healthy
4759	1	2026-06-25 04:28:43.265351+00	0	1	healthy
4760	5	2026-06-25 04:28:43.265351+00	0	1	healthy
4761	2	2026-06-25 04:28:43.265351+00	0	1	healthy
4762	3	2026-06-25 04:28:43.265351+00	0	1	healthy
4763	4	2026-06-25 04:28:43.265351+00	0	1	healthy
4769	1	2026-06-25 04:30:43.265706+00	0	1	healthy
4770	5	2026-06-25 04:30:43.265706+00	0	1	healthy
4771	2	2026-06-25 04:30:43.265706+00	0	1	healthy
4772	3	2026-06-25 04:30:43.265706+00	0	1	healthy
4773	4	2026-06-25 04:30:43.265706+00	0	1	healthy
4784	1	2026-06-25 04:33:43.265991+00	0	1	healthy
4785	5	2026-06-25 04:33:43.265991+00	0	1	healthy
4786	2	2026-06-25 04:33:43.265991+00	0	1	healthy
4787	3	2026-06-25 04:33:43.265991+00	0	1	healthy
4788	4	2026-06-25 04:33:43.265991+00	0	1	healthy
4804	1	2026-06-25 04:37:43.264567+00	0	1	healthy
4805	5	2026-06-25 04:37:43.264567+00	0	1	healthy
4806	2	2026-06-25 04:37:43.264567+00	0	1	healthy
4807	3	2026-06-25 04:37:43.264567+00	0	1	healthy
4808	4	2026-06-25 04:37:43.264567+00	0	1	healthy
4819	1	2026-06-25 04:40:43.264464+00	0	1	healthy
4820	5	2026-06-25 04:40:43.264464+00	0	1	healthy
4821	2	2026-06-25 04:40:43.264464+00	0	1	healthy
4822	3	2026-06-25 04:40:43.264464+00	0	1	healthy
4823	4	2026-06-25 04:40:43.264464+00	0	1	healthy
7149	1	2026-06-26 02:22:43.264915+00	0	1	healthy
7150	5	2026-06-26 02:22:43.264915+00	0	1	healthy
7151	2	2026-06-26 02:22:43.264915+00	0	1	healthy
7152	3	2026-06-26 02:22:43.264915+00	0	1	healthy
7153	4	2026-06-26 02:22:43.264915+00	0	1	healthy
4824	1	2026-06-25 04:41:43.357372+00	0	1	healthy
4825	5	2026-06-25 04:41:43.357372+00	0	1	healthy
4826	2	2026-06-25 04:41:43.357372+00	0	1	healthy
4827	3	2026-06-25 04:41:43.357372+00	0	1	healthy
4828	4	2026-06-25 04:41:43.357372+00	0	1	healthy
4829	1	2026-06-25 04:42:43.265966+00	0	1	healthy
4830	5	2026-06-25 04:42:43.265966+00	0	1	healthy
4831	2	2026-06-25 04:42:43.265966+00	0	1	healthy
4832	3	2026-06-25 04:42:43.265966+00	0	1	healthy
4833	4	2026-06-25 04:42:43.265966+00	0	1	healthy
4834	1	2026-06-25 04:43:43.265195+00	0	1	healthy
4835	5	2026-06-25 04:43:43.265195+00	0	1	healthy
4836	2	2026-06-25 04:43:43.265195+00	0	1	healthy
4837	3	2026-06-25 04:43:43.265195+00	0	1	healthy
4838	4	2026-06-25 04:43:43.265195+00	0	1	healthy
4839	1	2026-06-25 04:44:43.266791+00	0	1	healthy
4840	5	2026-06-25 04:44:43.266791+00	0	1	healthy
4841	2	2026-06-25 04:44:43.266791+00	0	1	healthy
4842	3	2026-06-25 04:44:43.266791+00	0	1	healthy
4843	4	2026-06-25 04:44:43.266791+00	0	1	healthy
4844	1	2026-06-25 04:45:43.264498+00	0	1	healthy
4845	5	2026-06-25 04:45:43.264498+00	0	1	healthy
4846	2	2026-06-25 04:45:43.264498+00	0	1	healthy
4847	3	2026-06-25 04:45:43.264498+00	0	1	healthy
4848	4	2026-06-25 04:45:43.264498+00	0	1	healthy
4849	1	2026-06-25 04:46:43.264397+00	0	1	healthy
4850	5	2026-06-25 04:46:43.264397+00	0	1	healthy
4851	2	2026-06-25 04:46:43.264397+00	0	1	healthy
4852	3	2026-06-25 04:46:43.264397+00	0	1	healthy
4853	4	2026-06-25 04:46:43.264397+00	0	1	healthy
4854	1	2026-06-25 04:47:43.264416+00	0	1	healthy
4855	5	2026-06-25 04:47:43.264416+00	0	1	healthy
4856	2	2026-06-25 04:47:43.264416+00	0	1	healthy
4857	3	2026-06-25 04:47:43.264416+00	0	1	healthy
4858	4	2026-06-25 04:47:43.264416+00	0	1	healthy
4859	1	2026-06-25 04:48:43.264351+00	0	1	healthy
4860	5	2026-06-25 04:48:43.264351+00	0	1	healthy
4861	2	2026-06-25 04:48:43.264351+00	0	1	healthy
4862	3	2026-06-25 04:48:43.264351+00	0	1	healthy
4863	4	2026-06-25 04:48:43.264351+00	0	1	healthy
4864	1	2026-06-25 04:49:43.266021+00	0	1	healthy
4865	5	2026-06-25 04:49:43.266021+00	0	1	healthy
4866	2	2026-06-25 04:49:43.266021+00	0	1	healthy
4867	3	2026-06-25 04:49:43.266021+00	0	1	healthy
4868	4	2026-06-25 04:49:43.266021+00	0	1	healthy
4869	1	2026-06-25 04:50:43.265693+00	0	1	healthy
4870	5	2026-06-25 04:50:43.265693+00	0	1	healthy
4871	2	2026-06-25 04:50:43.265693+00	0	1	healthy
4872	3	2026-06-25 04:50:43.265693+00	0	1	healthy
4873	4	2026-06-25 04:50:43.265693+00	0	1	healthy
4874	1	2026-06-25 04:51:43.264465+00	0	1	healthy
4875	5	2026-06-25 04:51:43.264465+00	0	1	healthy
4876	2	2026-06-25 04:51:43.264465+00	0	1	healthy
4877	3	2026-06-25 04:51:43.264465+00	0	1	healthy
4878	4	2026-06-25 04:51:43.264465+00	0	1	healthy
4879	1	2026-06-25 04:52:43.26501+00	0	1	healthy
4880	5	2026-06-25 04:52:43.26501+00	0	1	healthy
4881	2	2026-06-25 04:52:43.26501+00	0	1	healthy
4882	3	2026-06-25 04:52:43.26501+00	0	1	healthy
4883	4	2026-06-25 04:52:43.26501+00	0	1	healthy
4884	1	2026-06-25 04:53:43.264506+00	0	1	healthy
4885	5	2026-06-25 04:53:43.264506+00	0	1	healthy
4886	2	2026-06-25 04:53:43.264506+00	0	1	healthy
4887	3	2026-06-25 04:53:43.264506+00	0	1	healthy
4888	4	2026-06-25 04:53:43.264506+00	0	1	healthy
4889	1	2026-06-25 04:54:43.264776+00	0	1	healthy
4890	5	2026-06-25 04:54:43.264776+00	0	1	healthy
4891	2	2026-06-25 04:54:43.264776+00	0	1	healthy
4892	3	2026-06-25 04:54:43.264776+00	0	1	healthy
4893	4	2026-06-25 04:54:43.264776+00	0	1	healthy
4894	1	2026-06-25 04:55:43.265516+00	0	1	healthy
4895	5	2026-06-25 04:55:43.265516+00	0	1	healthy
4896	2	2026-06-25 04:55:43.265516+00	0	1	healthy
4897	3	2026-06-25 04:55:43.265516+00	0	1	healthy
4898	4	2026-06-25 04:55:43.265516+00	0	1	healthy
4899	1	2026-06-25 04:56:43.282341+00	0	1	healthy
4900	5	2026-06-25 04:56:43.282341+00	0	1	healthy
4901	2	2026-06-25 04:56:43.282341+00	0	1	healthy
4902	3	2026-06-25 04:56:43.282341+00	0	1	healthy
4903	4	2026-06-25 04:56:43.282341+00	0	1	healthy
4904	1	2026-06-25 04:57:43.273261+00	0	1	healthy
4905	5	2026-06-25 04:57:43.273261+00	0	1	healthy
4906	2	2026-06-25 04:57:43.273261+00	0	1	healthy
4907	3	2026-06-25 04:57:43.273261+00	0	1	healthy
4908	4	2026-06-25 04:57:43.273261+00	0	1	healthy
4909	1	2026-06-25 04:58:43.264759+00	0	1	healthy
4910	5	2026-06-25 04:58:43.264759+00	0	1	healthy
4911	2	2026-06-25 04:58:43.264759+00	0	1	healthy
4912	3	2026-06-25 04:58:43.264759+00	0	1	healthy
4913	4	2026-06-25 04:58:43.264759+00	0	1	healthy
4914	1	2026-06-25 04:59:43.266424+00	0	1	healthy
4915	5	2026-06-25 04:59:43.266424+00	0	1	healthy
4916	2	2026-06-25 04:59:43.266424+00	0	1	healthy
4917	3	2026-06-25 04:59:43.266424+00	0	1	healthy
4918	4	2026-06-25 04:59:43.266424+00	0	1	healthy
4919	1	2026-06-25 05:00:43.266006+00	0	1	healthy
4920	5	2026-06-25 05:00:43.266006+00	0	1	healthy
4921	2	2026-06-25 05:00:43.266006+00	0	1	healthy
4922	3	2026-06-25 05:00:43.266006+00	0	1	healthy
4923	4	2026-06-25 05:00:43.266006+00	0	1	healthy
4924	1	2026-06-25 05:01:43.26549+00	0	1	healthy
4925	5	2026-06-25 05:01:43.26549+00	0	1	healthy
4926	2	2026-06-25 05:01:43.26549+00	0	1	healthy
4927	3	2026-06-25 05:01:43.26549+00	0	1	healthy
4928	4	2026-06-25 05:01:43.26549+00	0	1	healthy
4929	1	2026-06-25 05:02:43.264816+00	0	1	healthy
4930	5	2026-06-25 05:02:43.264816+00	0	1	healthy
4931	2	2026-06-25 05:02:43.264816+00	0	1	healthy
4932	3	2026-06-25 05:02:43.264816+00	0	1	healthy
4933	4	2026-06-25 05:02:43.264816+00	0	1	healthy
4934	1	2026-06-25 05:03:43.265597+00	0	1	healthy
4935	5	2026-06-25 05:03:43.265597+00	0	1	healthy
4936	2	2026-06-25 05:03:43.265597+00	0	1	healthy
4937	3	2026-06-25 05:03:43.265597+00	0	1	healthy
4938	4	2026-06-25 05:03:43.265597+00	0	1	healthy
4939	1	2026-06-25 05:04:43.274211+00	0	1	healthy
4940	5	2026-06-25 05:04:43.274211+00	0	1	healthy
4941	2	2026-06-25 05:04:43.274211+00	0	1	healthy
4942	3	2026-06-25 05:04:43.274211+00	0	1	healthy
4943	4	2026-06-25 05:04:43.274211+00	0	1	healthy
4944	1	2026-06-25 05:05:43.265314+00	0	1	healthy
4945	5	2026-06-25 05:05:43.265314+00	0	1	healthy
4946	2	2026-06-25 05:05:43.265314+00	0	1	healthy
4947	3	2026-06-25 05:05:43.265314+00	0	1	healthy
4948	4	2026-06-25 05:05:43.265314+00	0	1	healthy
4969	1	2026-06-25 05:10:43.264626+00	0	1	healthy
4970	5	2026-06-25 05:10:43.264626+00	0	1	healthy
4971	2	2026-06-25 05:10:43.264626+00	0	1	healthy
4972	3	2026-06-25 05:10:43.264626+00	0	1	healthy
4973	4	2026-06-25 05:10:43.264626+00	0	1	healthy
4994	1	2026-06-25 05:39:43.421165+00	0	1	healthy
4995	5	2026-06-25 05:39:43.421165+00	0	1	healthy
4996	2	2026-06-25 05:39:43.421165+00	0	1	healthy
4997	3	2026-06-25 05:39:43.421165+00	0	1	healthy
4998	4	2026-06-25 05:39:43.421165+00	0	1	healthy
5004	1	2026-06-25 05:41:43.265342+00	0	1	healthy
5005	5	2026-06-25 05:41:43.265342+00	0	1	healthy
5006	2	2026-06-25 05:41:43.265342+00	0	1	healthy
5007	3	2026-06-25 05:41:43.265342+00	0	1	healthy
5008	4	2026-06-25 05:41:43.265342+00	0	1	healthy
5054	1	2026-06-25 05:51:43.26559+00	0	1	healthy
5055	5	2026-06-25 05:51:43.26559+00	0	1	healthy
5056	2	2026-06-25 05:51:43.26559+00	0	1	healthy
5057	3	2026-06-25 05:51:43.26559+00	0	1	healthy
5058	4	2026-06-25 05:51:43.26559+00	0	1	healthy
5104	1	2026-06-25 06:01:43.265641+00	0	1	healthy
5105	5	2026-06-25 06:01:43.265641+00	0	1	healthy
5106	2	2026-06-25 06:01:43.265641+00	0	1	healthy
5107	3	2026-06-25 06:01:43.265641+00	0	1	healthy
5108	4	2026-06-25 06:01:43.265641+00	0	1	healthy
5154	1	2026-06-25 06:11:43.265425+00	0	1	healthy
5155	5	2026-06-25 06:11:43.265425+00	0	1	healthy
5156	2	2026-06-25 06:11:43.265425+00	0	1	healthy
5157	3	2026-06-25 06:11:43.265425+00	0	1	healthy
5158	4	2026-06-25 06:11:43.265425+00	0	1	healthy
7154	1	2026-06-26 02:23:43.264638+00	0	1	healthy
7155	5	2026-06-26 02:23:43.264638+00	0	1	healthy
7156	2	2026-06-26 02:23:43.264638+00	0	1	healthy
7157	3	2026-06-26 02:23:43.264638+00	0	1	healthy
7158	4	2026-06-26 02:23:43.264638+00	0	1	healthy
7179	1	2026-06-26 02:28:43.265422+00	0	1	healthy
7180	5	2026-06-26 02:28:43.265422+00	0	1	healthy
7181	2	2026-06-26 02:28:43.265422+00	0	1	healthy
7182	3	2026-06-26 02:28:43.265422+00	0	1	healthy
7183	4	2026-06-26 02:28:43.265422+00	0	1	healthy
7184	1	2026-06-26 02:29:43.266636+00	0	1	healthy
7185	5	2026-06-26 02:29:43.266636+00	0	1	healthy
7186	2	2026-06-26 02:29:43.266636+00	0	1	healthy
7187	3	2026-06-26 02:29:43.266636+00	0	1	healthy
7188	4	2026-06-26 02:29:43.266636+00	0	1	healthy
7204	1	2026-06-26 02:33:43.265741+00	0	1	healthy
7205	5	2026-06-26 02:33:43.265741+00	0	1	healthy
7206	2	2026-06-26 02:33:43.265741+00	0	1	healthy
7207	3	2026-06-26 02:33:43.265741+00	0	1	healthy
7208	4	2026-06-26 02:33:43.265741+00	0	1	healthy
7219	1	2026-06-26 02:36:43.265569+00	0	1	healthy
7220	5	2026-06-26 02:36:43.265569+00	0	1	healthy
7221	2	2026-06-26 02:36:43.265569+00	0	1	healthy
7222	3	2026-06-26 02:36:43.265569+00	0	1	healthy
7223	4	2026-06-26 02:36:43.265569+00	0	1	healthy
7239	1	2026-06-26 02:40:43.265041+00	0	1	healthy
7240	5	2026-06-26 02:40:43.265041+00	0	1	healthy
7241	2	2026-06-26 02:40:43.265041+00	0	1	healthy
7242	3	2026-06-26 02:40:43.265041+00	0	1	healthy
7243	4	2026-06-26 02:40:43.265041+00	0	1	healthy
7249	1	2026-06-26 02:42:43.265329+00	0	1	healthy
7250	5	2026-06-26 02:42:43.265329+00	0	1	healthy
7251	2	2026-06-26 02:42:43.265329+00	0	1	healthy
7252	3	2026-06-26 02:42:43.265329+00	0	1	healthy
7253	4	2026-06-26 02:42:43.265329+00	0	1	healthy
7259	1	2026-06-26 02:44:43.265719+00	0	1	healthy
7260	5	2026-06-26 02:44:43.265719+00	0	1	healthy
7261	2	2026-06-26 02:44:43.265719+00	0	1	healthy
7262	3	2026-06-26 02:44:43.265719+00	0	1	healthy
7263	4	2026-06-26 02:44:43.265719+00	0	1	healthy
7284	1	2026-06-26 02:49:43.266005+00	0	1	healthy
7285	5	2026-06-26 02:49:43.266005+00	0	1	healthy
7286	2	2026-06-26 02:49:43.266005+00	0	1	healthy
7287	3	2026-06-26 02:49:43.266005+00	0	1	healthy
7288	4	2026-06-26 02:49:43.266005+00	0	1	healthy
7299	1	2026-06-26 02:52:43.26552+00	0	1	healthy
7300	5	2026-06-26 02:52:43.26552+00	0	1	healthy
7301	2	2026-06-26 02:52:43.26552+00	0	1	healthy
7302	3	2026-06-26 02:52:43.26552+00	0	1	healthy
7303	4	2026-06-26 02:52:43.26552+00	0	1	healthy
7304	1	2026-06-26 02:53:43.265323+00	0	1	healthy
7305	5	2026-06-26 02:53:43.265323+00	0	1	healthy
7306	2	2026-06-26 02:53:43.265323+00	0	1	healthy
7307	3	2026-06-26 02:53:43.265323+00	0	1	healthy
7308	4	2026-06-26 02:53:43.265323+00	0	1	healthy
7314	1	2026-06-26 02:55:43.266658+00	0	1	healthy
7315	5	2026-06-26 02:55:43.266658+00	0	1	healthy
7316	2	2026-06-26 02:55:43.266658+00	0	1	healthy
7317	3	2026-06-26 02:55:43.266658+00	0	1	healthy
7318	4	2026-06-26 02:55:43.266658+00	0	1	healthy
7324	1	2026-06-26 02:57:43.351107+00	0	1	healthy
7325	5	2026-06-26 02:57:43.351107+00	0	1	healthy
7326	2	2026-06-26 02:57:43.351107+00	0	1	healthy
7327	3	2026-06-26 02:57:43.351107+00	0	1	healthy
7328	4	2026-06-26 02:57:43.351107+00	0	1	healthy
7354	1	2026-06-26 03:03:43.265767+00	0	1	healthy
7355	5	2026-06-26 03:03:43.265767+00	0	1	healthy
7356	2	2026-06-26 03:03:43.265767+00	0	1	healthy
7357	3	2026-06-26 03:03:43.265767+00	0	1	healthy
7358	4	2026-06-26 03:03:43.265767+00	0	1	healthy
7369	1	2026-06-26 03:06:43.26435+00	0	1	healthy
7370	5	2026-06-26 03:06:43.26435+00	0	1	healthy
7371	2	2026-06-26 03:06:43.26435+00	0	1	healthy
7372	3	2026-06-26 03:06:43.26435+00	0	1	healthy
7373	4	2026-06-26 03:06:43.26435+00	0	1	healthy
7394	1	2026-06-26 03:11:43.265335+00	0	1	healthy
7395	5	2026-06-26 03:11:43.265335+00	0	1	healthy
7396	2	2026-06-26 03:11:43.265335+00	0	1	healthy
7397	3	2026-06-26 03:11:43.265335+00	0	1	healthy
7398	4	2026-06-26 03:11:43.265335+00	0	1	healthy
4949	1	2026-06-25 05:06:43.265465+00	0	1	healthy
4950	5	2026-06-25 05:06:43.265465+00	0	1	healthy
4951	2	2026-06-25 05:06:43.265465+00	0	1	healthy
4952	3	2026-06-25 05:06:43.265465+00	0	1	healthy
4953	4	2026-06-25 05:06:43.265465+00	0	1	healthy
4964	1	2026-06-25 05:09:43.266034+00	0	1	healthy
4965	5	2026-06-25 05:09:43.266034+00	0	1	healthy
4966	2	2026-06-25 05:09:43.266034+00	0	1	healthy
4967	3	2026-06-25 05:09:43.266034+00	0	1	healthy
4968	4	2026-06-25 05:09:43.266034+00	0	1	healthy
4979	1	2026-06-25 05:12:43.264745+00	0	1	healthy
4980	5	2026-06-25 05:12:43.264745+00	0	1	healthy
4981	2	2026-06-25 05:12:43.264745+00	0	1	healthy
4982	3	2026-06-25 05:12:43.264745+00	0	1	healthy
4983	4	2026-06-25 05:12:43.264745+00	0	1	healthy
5014	1	2026-06-25 05:43:43.264739+00	0	1	healthy
5015	5	2026-06-25 05:43:43.264739+00	0	1	healthy
5016	2	2026-06-25 05:43:43.264739+00	0	1	healthy
5017	3	2026-06-25 05:43:43.264739+00	0	1	healthy
5018	4	2026-06-25 05:43:43.264739+00	0	1	healthy
5029	1	2026-06-25 05:46:43.264343+00	0	1	healthy
5030	5	2026-06-25 05:46:43.264343+00	0	1	healthy
5031	2	2026-06-25 05:46:43.264343+00	0	1	healthy
5032	3	2026-06-25 05:46:43.264343+00	0	1	healthy
5033	4	2026-06-25 05:46:43.264343+00	0	1	healthy
5059	1	2026-06-25 05:52:43.287325+00	0	1	healthy
5060	5	2026-06-25 05:52:43.287325+00	0	1	healthy
5061	2	2026-06-25 05:52:43.287325+00	0	1	healthy
5062	3	2026-06-25 05:52:43.287325+00	0	1	healthy
5063	4	2026-06-25 05:52:43.287325+00	0	1	healthy
5074	1	2026-06-25 05:55:43.264761+00	0	1	healthy
5075	5	2026-06-25 05:55:43.264761+00	0	1	healthy
5076	2	2026-06-25 05:55:43.264761+00	0	1	healthy
5077	3	2026-06-25 05:55:43.264761+00	0	1	healthy
5078	4	2026-06-25 05:55:43.264761+00	0	1	healthy
5079	1	2026-06-25 05:56:43.265764+00	0	1	healthy
5080	5	2026-06-25 05:56:43.265764+00	0	1	healthy
5081	2	2026-06-25 05:56:43.265764+00	0	1	healthy
5082	3	2026-06-25 05:56:43.265764+00	0	1	healthy
5083	4	2026-06-25 05:56:43.265764+00	0	1	healthy
5109	1	2026-06-25 06:02:43.266136+00	0	1	healthy
5110	5	2026-06-25 06:02:43.266136+00	0	1	healthy
5111	2	2026-06-25 06:02:43.266136+00	0	1	healthy
5112	3	2026-06-25 06:02:43.266136+00	0	1	healthy
5113	4	2026-06-25 06:02:43.266136+00	0	1	healthy
5124	1	2026-06-25 06:05:43.265297+00	0	1	healthy
5125	5	2026-06-25 06:05:43.265297+00	0	1	healthy
5126	2	2026-06-25 06:05:43.265297+00	0	1	healthy
5127	3	2026-06-25 06:05:43.265297+00	0	1	healthy
5128	4	2026-06-25 06:05:43.265297+00	0	1	healthy
5169	1	2026-06-25 06:14:43.266078+00	0	1	healthy
5170	5	2026-06-25 06:14:43.266078+00	0	1	healthy
5171	2	2026-06-25 06:14:43.266078+00	0	1	healthy
5172	3	2026-06-25 06:14:43.266078+00	0	1	healthy
5173	4	2026-06-25 06:14:43.266078+00	0	1	healthy
7159	1	2026-06-26 02:24:43.266352+00	0	1	healthy
7160	5	2026-06-26 02:24:43.266352+00	0	1	healthy
7161	2	2026-06-26 02:24:43.266352+00	0	1	healthy
7162	3	2026-06-26 02:24:43.266352+00	0	1	healthy
7163	4	2026-06-26 02:24:43.266352+00	0	1	healthy
7169	1	2026-06-26 02:26:43.26441+00	0	1	healthy
7170	5	2026-06-26 02:26:43.26441+00	0	1	healthy
7171	2	2026-06-26 02:26:43.26441+00	0	1	healthy
7172	3	2026-06-26 02:26:43.26441+00	0	1	healthy
7173	4	2026-06-26 02:26:43.26441+00	0	1	healthy
7194	1	2026-06-26 02:31:43.264881+00	0	1	healthy
7195	5	2026-06-26 02:31:43.264881+00	0	1	healthy
7196	2	2026-06-26 02:31:43.264881+00	0	1	healthy
7197	3	2026-06-26 02:31:43.264881+00	0	1	healthy
7198	4	2026-06-26 02:31:43.264881+00	0	1	healthy
7209	1	2026-06-26 02:34:43.264535+00	0	1	healthy
7210	5	2026-06-26 02:34:43.264535+00	0	1	healthy
7211	2	2026-06-26 02:34:43.264535+00	0	1	healthy
7212	3	2026-06-26 02:34:43.264535+00	0	1	healthy
7213	4	2026-06-26 02:34:43.264535+00	0	1	healthy
7289	1	2026-06-26 02:50:43.264894+00	0	1	healthy
7290	5	2026-06-26 02:50:43.264894+00	0	1	healthy
7291	2	2026-06-26 02:50:43.264894+00	0	1	healthy
7292	3	2026-06-26 02:50:43.264894+00	0	1	healthy
7293	4	2026-06-26 02:50:43.264894+00	0	1	healthy
7334	1	2026-06-26 02:59:43.266507+00	0	1	healthy
7335	5	2026-06-26 02:59:43.266507+00	0	1	healthy
7336	2	2026-06-26 02:59:43.266507+00	0	1	healthy
7337	3	2026-06-26 02:59:43.266507+00	0	1	healthy
7338	4	2026-06-26 02:59:43.266507+00	0	1	healthy
7349	1	2026-06-26 03:02:43.265452+00	0	1	healthy
7350	5	2026-06-26 03:02:43.265452+00	0	1	healthy
7351	2	2026-06-26 03:02:43.265452+00	0	1	healthy
7352	3	2026-06-26 03:02:43.265452+00	0	1	healthy
7353	4	2026-06-26 03:02:43.265452+00	0	1	healthy
7374	1	2026-06-26 03:07:43.26504+00	0	1	healthy
7375	5	2026-06-26 03:07:43.26504+00	0	1	healthy
7376	2	2026-06-26 03:07:43.26504+00	0	1	healthy
7377	3	2026-06-26 03:07:43.26504+00	0	1	healthy
7378	4	2026-06-26 03:07:43.26504+00	0	1	healthy
7389	1	2026-06-26 03:10:43.265075+00	0	1	healthy
7390	5	2026-06-26 03:10:43.265075+00	0	1	healthy
7391	2	2026-06-26 03:10:43.265075+00	0	1	healthy
7392	3	2026-06-26 03:10:43.265075+00	0	1	healthy
7393	4	2026-06-26 03:10:43.265075+00	0	1	healthy
4954	1	2026-06-25 05:07:43.264963+00	0	1	healthy
4955	5	2026-06-25 05:07:43.264963+00	0	1	healthy
4956	2	2026-06-25 05:07:43.264963+00	0	1	healthy
4957	3	2026-06-25 05:07:43.264963+00	0	1	healthy
4958	4	2026-06-25 05:07:43.264963+00	0	1	healthy
4974	1	2026-06-25 05:11:43.344119+00	0	1	healthy
4975	5	2026-06-25 05:11:43.344119+00	0	1	healthy
4976	2	2026-06-25 05:11:43.344119+00	0	1	healthy
4977	3	2026-06-25 05:11:43.344119+00	0	1	healthy
4978	4	2026-06-25 05:11:43.344119+00	0	1	healthy
4999	1	2026-06-25 05:40:43.26573+00	0	1	healthy
5000	5	2026-06-25 05:40:43.26573+00	0	1	healthy
5001	2	2026-06-25 05:40:43.26573+00	0	1	healthy
5002	3	2026-06-25 05:40:43.26573+00	0	1	healthy
5003	4	2026-06-25 05:40:43.26573+00	0	1	healthy
5034	1	2026-06-25 05:47:43.2648+00	0	1	healthy
5035	5	2026-06-25 05:47:43.2648+00	0	1	healthy
5036	2	2026-06-25 05:47:43.2648+00	0	1	healthy
5037	3	2026-06-25 05:47:43.2648+00	0	1	healthy
5038	4	2026-06-25 05:47:43.2648+00	0	1	healthy
5069	1	2026-06-25 05:54:43.264814+00	0	1	healthy
5070	5	2026-06-25 05:54:43.264814+00	0	1	healthy
5071	2	2026-06-25 05:54:43.264814+00	0	1	healthy
5072	3	2026-06-25 05:54:43.264814+00	0	1	healthy
5073	4	2026-06-25 05:54:43.264814+00	0	1	healthy
5094	1	2026-06-25 05:59:43.266544+00	0	1	healthy
5095	5	2026-06-25 05:59:43.266544+00	0	1	healthy
5096	2	2026-06-25 05:59:43.266544+00	0	1	healthy
5097	3	2026-06-25 05:59:43.266544+00	0	1	healthy
5098	4	2026-06-25 05:59:43.266544+00	0	1	healthy
5114	1	2026-06-25 06:03:43.265866+00	0	1	healthy
5115	5	2026-06-25 06:03:43.265866+00	0	1	healthy
5116	2	2026-06-25 06:03:43.265866+00	0	1	healthy
5117	3	2026-06-25 06:03:43.265866+00	0	1	healthy
5118	4	2026-06-25 06:03:43.265866+00	0	1	healthy
5129	1	2026-06-25 06:06:43.264585+00	0	1	healthy
5130	5	2026-06-25 06:06:43.264585+00	0	1	healthy
5131	2	2026-06-25 06:06:43.264585+00	0	1	healthy
5132	3	2026-06-25 06:06:43.264585+00	0	1	healthy
5133	4	2026-06-25 06:06:43.264585+00	0	1	healthy
5144	1	2026-06-25 06:09:43.267659+00	0	1	healthy
5145	5	2026-06-25 06:09:43.267659+00	0	1	healthy
5146	2	2026-06-25 06:09:43.267659+00	0	1	healthy
5147	3	2026-06-25 06:09:43.267659+00	0	1	healthy
5148	4	2026-06-25 06:09:43.267659+00	0	1	healthy
5159	1	2026-06-25 06:12:43.265505+00	0	1	healthy
5160	5	2026-06-25 06:12:43.265505+00	0	1	healthy
5161	2	2026-06-25 06:12:43.265505+00	0	1	healthy
5162	3	2026-06-25 06:12:43.265505+00	0	1	healthy
5163	4	2026-06-25 06:12:43.265505+00	0	1	healthy
7164	1	2026-06-26 02:25:43.264511+00	0	1	healthy
7165	5	2026-06-26 02:25:43.264511+00	0	1	healthy
7166	2	2026-06-26 02:25:43.264511+00	0	1	healthy
7167	3	2026-06-26 02:25:43.264511+00	0	1	healthy
7168	4	2026-06-26 02:25:43.264511+00	0	1	healthy
7229	1	2026-06-26 02:38:43.264965+00	0	1	healthy
7230	5	2026-06-26 02:38:43.264965+00	0	1	healthy
7231	2	2026-06-26 02:38:43.264965+00	0	1	healthy
7232	3	2026-06-26 02:38:43.264965+00	0	1	healthy
7233	4	2026-06-26 02:38:43.264965+00	0	1	healthy
7264	1	2026-06-26 02:45:43.265437+00	0	1	healthy
7265	5	2026-06-26 02:45:43.265437+00	0	1	healthy
7266	2	2026-06-26 02:45:43.265437+00	0	1	healthy
7267	3	2026-06-26 02:45:43.265437+00	0	1	healthy
7268	4	2026-06-26 02:45:43.265437+00	0	1	healthy
7274	1	2026-06-26 02:47:43.265885+00	0	1	healthy
7275	5	2026-06-26 02:47:43.265885+00	0	1	healthy
7276	2	2026-06-26 02:47:43.265885+00	0	1	healthy
7277	3	2026-06-26 02:47:43.265885+00	0	1	healthy
7278	4	2026-06-26 02:47:43.265885+00	0	1	healthy
7294	1	2026-06-26 02:51:43.265543+00	0	1	healthy
7295	5	2026-06-26 02:51:43.265543+00	0	1	healthy
7296	2	2026-06-26 02:51:43.265543+00	0	1	healthy
7297	3	2026-06-26 02:51:43.265543+00	0	1	healthy
7298	4	2026-06-26 02:51:43.265543+00	0	1	healthy
7404	1	2026-06-26 03:13:43.264638+00	0	1	healthy
7405	5	2026-06-26 03:13:43.264638+00	0	1	healthy
7406	2	2026-06-26 03:13:43.264638+00	0	1	healthy
7407	3	2026-06-26 03:13:43.264638+00	0	1	healthy
7408	4	2026-06-26 03:13:43.264638+00	0	1	healthy
4959	1	2026-06-25 05:08:43.265237+00	0	1	healthy
4960	5	2026-06-25 05:08:43.265237+00	0	1	healthy
4961	2	2026-06-25 05:08:43.265237+00	0	1	healthy
4962	3	2026-06-25 05:08:43.265237+00	0	1	healthy
4963	4	2026-06-25 05:08:43.265237+00	0	1	healthy
4984	1	2026-06-25 05:22:43.266001+00	0	1	healthy
4985	5	2026-06-25 05:22:43.266001+00	0	1	healthy
4986	2	2026-06-25 05:22:43.266001+00	0	1	healthy
4987	3	2026-06-25 05:22:43.266001+00	0	1	healthy
4988	4	2026-06-25 05:22:43.266001+00	0	1	healthy
5019	1	2026-06-25 05:44:43.264946+00	0	1	healthy
5020	5	2026-06-25 05:44:43.264946+00	0	1	healthy
5021	2	2026-06-25 05:44:43.264946+00	0	1	healthy
5022	3	2026-06-25 05:44:43.264946+00	0	1	healthy
5023	4	2026-06-25 05:44:43.264946+00	0	1	healthy
5039	1	2026-06-25 05:48:43.264946+00	0	1	healthy
5040	5	2026-06-25 05:48:43.264946+00	0	1	healthy
5041	2	2026-06-25 05:48:43.264946+00	0	1	healthy
5042	3	2026-06-25 05:48:43.264946+00	0	1	healthy
5043	4	2026-06-25 05:48:43.264946+00	0	1	healthy
5049	1	2026-06-25 05:50:43.265792+00	0	1	healthy
5050	5	2026-06-25 05:50:43.265792+00	0	1	healthy
5051	2	2026-06-25 05:50:43.265792+00	0	1	healthy
5052	3	2026-06-25 05:50:43.265792+00	0	1	healthy
5053	4	2026-06-25 05:50:43.265792+00	0	1	healthy
5084	1	2026-06-25 05:57:43.266176+00	0	1	healthy
5085	5	2026-06-25 05:57:43.266176+00	0	1	healthy
5086	2	2026-06-25 05:57:43.266176+00	0	1	healthy
5087	3	2026-06-25 05:57:43.266176+00	0	1	healthy
5088	4	2026-06-25 05:57:43.266176+00	0	1	healthy
5119	1	2026-06-25 06:04:43.264815+00	0	1	healthy
5120	5	2026-06-25 06:04:43.264815+00	0	1	healthy
5121	2	2026-06-25 06:04:43.264815+00	0	1	healthy
5122	3	2026-06-25 06:04:43.264815+00	0	1	healthy
5123	4	2026-06-25 06:04:43.264815+00	0	1	healthy
5139	1	2026-06-25 06:08:43.264328+00	0	1	healthy
5140	5	2026-06-25 06:08:43.264328+00	0	1	healthy
5141	2	2026-06-25 06:08:43.264328+00	0	1	healthy
5142	3	2026-06-25 06:08:43.264328+00	0	1	healthy
5143	4	2026-06-25 06:08:43.264328+00	0	1	healthy
5164	1	2026-06-25 06:13:43.265825+00	0	1	healthy
5165	5	2026-06-25 06:13:43.265825+00	0	1	healthy
5166	2	2026-06-25 06:13:43.265825+00	0	1	healthy
5167	3	2026-06-25 06:13:43.265825+00	0	1	healthy
5168	4	2026-06-25 06:13:43.265825+00	0	1	healthy
7174	1	2026-06-26 02:27:43.269536+00	0	1	healthy
7175	5	2026-06-26 02:27:43.269536+00	0	1	healthy
7176	2	2026-06-26 02:27:43.269536+00	0	1	healthy
7177	3	2026-06-26 02:27:43.269536+00	0	1	healthy
7178	4	2026-06-26 02:27:43.269536+00	0	1	healthy
7214	1	2026-06-26 02:35:43.265648+00	0	1	healthy
7215	5	2026-06-26 02:35:43.265648+00	0	1	healthy
7216	2	2026-06-26 02:35:43.265648+00	0	1	healthy
7217	3	2026-06-26 02:35:43.265648+00	0	1	healthy
7218	4	2026-06-26 02:35:43.265648+00	0	1	healthy
7224	1	2026-06-26 02:37:43.264643+00	0	1	healthy
7225	5	2026-06-26 02:37:43.264643+00	0	1	healthy
7226	2	2026-06-26 02:37:43.264643+00	0	1	healthy
7227	3	2026-06-26 02:37:43.264643+00	0	1	healthy
7228	4	2026-06-26 02:37:43.264643+00	0	1	healthy
7244	1	2026-06-26 02:41:43.265406+00	0	1	healthy
7245	5	2026-06-26 02:41:43.265406+00	0	1	healthy
7246	2	2026-06-26 02:41:43.265406+00	0	1	healthy
7247	3	2026-06-26 02:41:43.265406+00	0	1	healthy
7248	4	2026-06-26 02:41:43.265406+00	0	1	healthy
7319	1	2026-06-26 02:56:43.265681+00	0	1	healthy
7320	5	2026-06-26 02:56:43.265681+00	0	1	healthy
7321	2	2026-06-26 02:56:43.265681+00	0	1	healthy
7322	3	2026-06-26 02:56:43.265681+00	0	1	healthy
7323	4	2026-06-26 02:56:43.265681+00	0	1	healthy
7379	1	2026-06-26 03:08:43.265981+00	0	1	healthy
7380	5	2026-06-26 03:08:43.265981+00	0	1	healthy
7381	2	2026-06-26 03:08:43.265981+00	0	1	healthy
7382	3	2026-06-26 03:08:43.265981+00	0	1	healthy
7383	4	2026-06-26 03:08:43.265981+00	0	1	healthy
7409	1	2026-06-26 03:14:43.266955+00	0	1	healthy
7410	5	2026-06-26 03:14:43.266955+00	0	1	healthy
7411	2	2026-06-26 03:14:43.266955+00	0	1	healthy
7412	3	2026-06-26 03:14:43.266955+00	0	1	healthy
7413	4	2026-06-26 03:14:43.266955+00	0	1	healthy
4989	1	2026-06-25 05:38:43.264802+00	0	1	healthy
4990	5	2026-06-25 05:38:43.264802+00	0	1	healthy
4991	2	2026-06-25 05:38:43.264802+00	0	1	healthy
4992	3	2026-06-25 05:38:43.264802+00	0	1	healthy
4993	4	2026-06-25 05:38:43.264802+00	0	1	healthy
5009	1	2026-06-25 05:42:43.26547+00	0	1	healthy
5010	5	2026-06-25 05:42:43.26547+00	0	1	healthy
5011	2	2026-06-25 05:42:43.26547+00	0	1	healthy
5012	3	2026-06-25 05:42:43.26547+00	0	1	healthy
5013	4	2026-06-25 05:42:43.26547+00	0	1	healthy
5024	1	2026-06-25 05:45:43.265794+00	0	1	healthy
5025	5	2026-06-25 05:45:43.265794+00	0	1	healthy
5026	2	2026-06-25 05:45:43.265794+00	0	1	healthy
5027	3	2026-06-25 05:45:43.265794+00	0	1	healthy
5028	4	2026-06-25 05:45:43.265794+00	0	1	healthy
5044	1	2026-06-25 05:49:43.266672+00	0	1	healthy
5045	5	2026-06-25 05:49:43.266672+00	0	1	healthy
5046	2	2026-06-25 05:49:43.266672+00	0	1	healthy
5047	3	2026-06-25 05:49:43.266672+00	0	1	healthy
5048	4	2026-06-25 05:49:43.266672+00	0	1	healthy
5064	1	2026-06-25 05:53:43.266667+00	0	1	healthy
5065	5	2026-06-25 05:53:43.266667+00	0	1	healthy
5066	2	2026-06-25 05:53:43.266667+00	0	1	healthy
5067	3	2026-06-25 05:53:43.266667+00	0	1	healthy
5068	4	2026-06-25 05:53:43.266667+00	0	1	healthy
5089	1	2026-06-25 05:58:43.26566+00	0	1	healthy
5090	5	2026-06-25 05:58:43.26566+00	0	1	healthy
5091	2	2026-06-25 05:58:43.26566+00	0	1	healthy
5092	3	2026-06-25 05:58:43.26566+00	0	1	healthy
5093	4	2026-06-25 05:58:43.26566+00	0	1	healthy
5099	1	2026-06-25 06:00:43.26614+00	0	1	healthy
5100	5	2026-06-25 06:00:43.26614+00	0	1	healthy
5101	2	2026-06-25 06:00:43.26614+00	0	1	healthy
5102	3	2026-06-25 06:00:43.26614+00	0	1	healthy
5103	4	2026-06-25 06:00:43.26614+00	0	1	healthy
5134	1	2026-06-25 06:07:43.352214+00	0	1	healthy
5135	5	2026-06-25 06:07:43.352214+00	0	1	healthy
5136	2	2026-06-25 06:07:43.352214+00	0	1	healthy
5137	3	2026-06-25 06:07:43.352214+00	0	1	healthy
5138	4	2026-06-25 06:07:43.352214+00	0	1	healthy
5149	1	2026-06-25 06:10:43.264518+00	0	1	healthy
5150	5	2026-06-25 06:10:43.264518+00	0	1	healthy
5151	2	2026-06-25 06:10:43.264518+00	0	1	healthy
5152	3	2026-06-25 06:10:43.264518+00	0	1	healthy
5153	4	2026-06-25 06:10:43.264518+00	0	1	healthy
5174	1	2026-06-25 06:15:43.264826+00	0	1	healthy
5175	5	2026-06-25 06:15:43.264826+00	0	1	healthy
5176	2	2026-06-25 06:15:43.264826+00	0	1	healthy
5177	3	2026-06-25 06:15:43.264826+00	0	1	healthy
5178	4	2026-06-25 06:15:43.264826+00	0	1	healthy
5179	1	2026-06-25 06:16:43.265093+00	0	1	healthy
5180	5	2026-06-25 06:16:43.265093+00	0	1	healthy
5181	2	2026-06-25 06:16:43.265093+00	0	1	healthy
5182	3	2026-06-25 06:16:43.265093+00	0	1	healthy
5183	4	2026-06-25 06:16:43.265093+00	0	1	healthy
5184	1	2026-06-25 06:17:43.264609+00	0	1	healthy
5185	5	2026-06-25 06:17:43.264609+00	0	1	healthy
5186	2	2026-06-25 06:17:43.264609+00	0	1	healthy
5187	3	2026-06-25 06:17:43.264609+00	0	1	healthy
5188	4	2026-06-25 06:17:43.264609+00	0	1	healthy
5189	1	2026-06-25 06:18:43.266319+00	0	1	healthy
5190	5	2026-06-25 06:18:43.266319+00	0	1	healthy
5191	2	2026-06-25 06:18:43.266319+00	0	1	healthy
5192	3	2026-06-25 06:18:43.266319+00	0	1	healthy
5193	4	2026-06-25 06:18:43.266319+00	0	1	healthy
5194	1	2026-06-25 06:19:43.270802+00	0	1	healthy
5195	5	2026-06-25 06:19:43.270802+00	0	1	healthy
5196	2	2026-06-25 06:19:43.270802+00	0	1	healthy
5197	3	2026-06-25 06:19:43.270802+00	0	1	healthy
5198	4	2026-06-25 06:19:43.270802+00	0	1	healthy
5199	1	2026-06-25 06:20:43.265439+00	0	1	healthy
5200	5	2026-06-25 06:20:43.265439+00	0	1	healthy
5201	2	2026-06-25 06:20:43.265439+00	0	1	healthy
5202	3	2026-06-25 06:20:43.265439+00	0	1	healthy
5203	4	2026-06-25 06:20:43.265439+00	0	1	healthy
5204	1	2026-06-25 06:21:43.2645+00	0	1	healthy
5205	5	2026-06-25 06:21:43.2645+00	0	1	healthy
5206	2	2026-06-25 06:21:43.2645+00	0	1	healthy
5207	3	2026-06-25 06:21:43.2645+00	0	1	healthy
5208	4	2026-06-25 06:21:43.2645+00	0	1	healthy
5209	1	2026-06-25 06:22:43.334511+00	0	1	healthy
5210	5	2026-06-25 06:22:43.334511+00	0	1	healthy
5211	2	2026-06-25 06:22:43.334511+00	0	1	healthy
5212	3	2026-06-25 06:22:43.334511+00	0	1	healthy
5213	4	2026-06-25 06:22:43.334511+00	0	1	healthy
5214	1	2026-06-25 06:23:43.26728+00	0	1	healthy
5215	5	2026-06-25 06:23:43.26728+00	0	1	healthy
5216	2	2026-06-25 06:23:43.26728+00	0	1	healthy
5217	3	2026-06-25 06:23:43.26728+00	0	1	healthy
5218	4	2026-06-25 06:23:43.26728+00	0	1	healthy
5219	1	2026-06-25 06:24:43.278722+00	0	1	healthy
5220	5	2026-06-25 06:24:43.278722+00	0	1	healthy
5221	2	2026-06-25 06:24:43.278722+00	0	1	healthy
5222	3	2026-06-25 06:24:43.278722+00	0	1	healthy
5223	4	2026-06-25 06:24:43.278722+00	0	1	healthy
5224	1	2026-06-25 06:25:43.264639+00	0	1	healthy
5225	5	2026-06-25 06:25:43.264639+00	0	1	healthy
5226	2	2026-06-25 06:25:43.264639+00	0	1	healthy
5227	3	2026-06-25 06:25:43.264639+00	0	1	healthy
5228	4	2026-06-25 06:25:43.264639+00	0	1	healthy
5229	1	2026-06-25 06:26:43.265591+00	0	1	healthy
5230	5	2026-06-25 06:26:43.265591+00	0	1	healthy
5231	2	2026-06-25 06:26:43.265591+00	0	1	healthy
5232	3	2026-06-25 06:26:43.265591+00	0	1	healthy
5233	4	2026-06-25 06:26:43.265591+00	0	1	healthy
5234	1	2026-06-25 06:27:43.269906+00	0	1	healthy
5235	5	2026-06-25 06:27:43.269906+00	0	1	healthy
5236	2	2026-06-25 06:27:43.269906+00	0	1	healthy
5237	3	2026-06-25 06:27:43.269906+00	0	1	healthy
5238	4	2026-06-25 06:27:43.269906+00	0	1	healthy
5239	1	2026-06-25 06:28:43.266459+00	0	1	healthy
5240	5	2026-06-25 06:28:43.266459+00	0	1	healthy
5241	2	2026-06-25 06:28:43.266459+00	0	1	healthy
5242	3	2026-06-25 06:28:43.266459+00	0	1	healthy
5243	4	2026-06-25 06:28:43.266459+00	0	1	healthy
5244	1	2026-06-25 06:29:43.26728+00	0	1	healthy
5245	5	2026-06-25 06:29:43.26728+00	0	1	healthy
5246	2	2026-06-25 06:29:43.26728+00	0	1	healthy
5247	3	2026-06-25 06:29:43.26728+00	0	1	healthy
5248	4	2026-06-25 06:29:43.26728+00	0	1	healthy
5249	1	2026-06-25 06:30:43.264735+00	0	1	healthy
5250	5	2026-06-25 06:30:43.264735+00	0	1	healthy
5251	2	2026-06-25 06:30:43.264735+00	0	1	healthy
5252	3	2026-06-25 06:30:43.264735+00	0	1	healthy
5253	4	2026-06-25 06:30:43.264735+00	0	1	healthy
5259	1	2026-06-25 06:32:43.268294+00	0	1	healthy
5260	5	2026-06-25 06:32:43.268294+00	0	1	healthy
5261	2	2026-06-25 06:32:43.268294+00	0	1	healthy
5262	3	2026-06-25 06:32:43.268294+00	0	1	healthy
5263	4	2026-06-25 06:32:43.268294+00	0	1	healthy
5274	1	2026-06-25 06:35:43.265746+00	0	1	healthy
5275	5	2026-06-25 06:35:43.265746+00	0	1	healthy
5276	2	2026-06-25 06:35:43.265746+00	0	1	healthy
5277	3	2026-06-25 06:35:43.265746+00	0	1	healthy
5278	4	2026-06-25 06:35:43.265746+00	0	1	healthy
5304	1	2026-06-25 06:41:43.266191+00	0	1	healthy
5305	5	2026-06-25 06:41:43.266191+00	0	1	healthy
5306	2	2026-06-25 06:41:43.266191+00	0	1	healthy
5307	3	2026-06-25 06:41:43.266191+00	0	1	healthy
5308	4	2026-06-25 06:41:43.266191+00	0	1	healthy
5369	1	2026-06-25 06:54:43.26697+00	0	1	healthy
5370	5	2026-06-25 06:54:43.26697+00	0	1	healthy
5371	2	2026-06-25 06:54:43.26697+00	0	1	healthy
5372	3	2026-06-25 06:54:43.26697+00	0	1	healthy
5373	4	2026-06-25 06:54:43.26697+00	0	1	healthy
5389	1	2026-06-25 06:58:43.265652+00	0	1	healthy
5390	5	2026-06-25 06:58:43.265652+00	0	1	healthy
5391	2	2026-06-25 06:58:43.265652+00	0	1	healthy
5392	3	2026-06-25 06:58:43.265652+00	0	1	healthy
5393	4	2026-06-25 06:58:43.265652+00	0	1	healthy
5399	1	2026-06-25 07:00:43.267415+00	0	1	healthy
5400	5	2026-06-25 07:00:43.267415+00	0	1	healthy
5401	2	2026-06-25 07:00:43.267415+00	0	1	healthy
5402	3	2026-06-25 07:00:43.267415+00	0	1	healthy
5403	4	2026-06-25 07:00:43.267415+00	0	1	healthy
5434	1	2026-06-25 07:07:43.264954+00	0	1	healthy
5435	5	2026-06-25 07:07:43.264954+00	0	1	healthy
5436	2	2026-06-25 07:07:43.264954+00	0	1	healthy
5437	3	2026-06-25 07:07:43.264954+00	0	1	healthy
5438	4	2026-06-25 07:07:43.264954+00	0	1	healthy
5459	1	2026-06-25 07:12:43.264766+00	0	1	healthy
5460	5	2026-06-25 07:12:43.264766+00	0	1	healthy
5461	2	2026-06-25 07:12:43.264766+00	0	1	healthy
5462	3	2026-06-25 07:12:43.264766+00	0	1	healthy
5463	4	2026-06-25 07:12:43.264766+00	0	1	healthy
5474	1	2026-06-25 07:15:43.265399+00	0	1	healthy
5475	5	2026-06-25 07:15:43.265399+00	0	1	healthy
5476	2	2026-06-25 07:15:43.265399+00	0	1	healthy
5477	3	2026-06-25 07:15:43.265399+00	0	1	healthy
5478	4	2026-06-25 07:15:43.265399+00	0	1	healthy
5504	1	2026-06-25 07:21:43.264319+00	0	1	healthy
5505	5	2026-06-25 07:21:43.264319+00	0	1	healthy
5506	2	2026-06-25 07:21:43.264319+00	0	1	healthy
5507	3	2026-06-25 07:21:43.264319+00	0	1	healthy
5508	4	2026-06-25 07:21:43.264319+00	0	1	healthy
5544	1	2026-06-25 07:29:43.266336+00	0	1	healthy
5545	5	2026-06-25 07:29:43.266336+00	0	1	healthy
5546	2	2026-06-25 07:29:43.266336+00	0	1	healthy
5547	3	2026-06-25 07:29:43.266336+00	0	1	healthy
5548	4	2026-06-25 07:29:43.266336+00	0	1	healthy
5564	1	2026-06-25 07:33:43.264828+00	0	1	healthy
5565	5	2026-06-25 07:33:43.264828+00	0	1	healthy
5566	2	2026-06-25 07:33:43.264828+00	0	1	healthy
5567	3	2026-06-25 07:33:43.264828+00	0	1	healthy
5568	4	2026-06-25 07:33:43.264828+00	0	1	healthy
5579	1	2026-06-25 07:36:43.265453+00	0	1	healthy
5580	5	2026-06-25 07:36:43.265453+00	0	1	healthy
5581	2	2026-06-25 07:36:43.265453+00	0	1	healthy
5582	3	2026-06-25 07:36:43.265453+00	0	1	healthy
5583	4	2026-06-25 07:36:43.265453+00	0	1	healthy
5594	1	2026-06-25 07:39:43.273221+00	0	1	healthy
5595	5	2026-06-25 07:39:43.273221+00	0	1	healthy
5596	2	2026-06-25 07:39:43.273221+00	0	1	healthy
5597	3	2026-06-25 07:39:43.273221+00	0	1	healthy
5598	4	2026-06-25 07:39:43.273221+00	0	1	healthy
5619	1	2026-06-25 07:44:43.265639+00	0	1	healthy
5620	5	2026-06-25 07:44:43.265639+00	0	1	healthy
5621	2	2026-06-25 07:44:43.265639+00	0	1	healthy
5622	3	2026-06-25 07:44:43.265639+00	0	1	healthy
5623	4	2026-06-25 07:44:43.265639+00	0	1	healthy
5634	1	2026-06-25 07:47:43.265397+00	0	1	healthy
5635	5	2026-06-25 07:47:43.265397+00	0	1	healthy
5636	2	2026-06-25 07:47:43.265397+00	0	1	healthy
5637	3	2026-06-25 07:47:43.265397+00	0	1	healthy
5638	4	2026-06-25 07:47:43.265397+00	0	1	healthy
5669	1	2026-06-25 07:54:43.267314+00	0	1	healthy
5670	5	2026-06-25 07:54:43.267314+00	0	1	healthy
5671	2	2026-06-25 07:54:43.267314+00	0	1	healthy
5672	3	2026-06-25 07:54:43.267314+00	0	1	healthy
5673	4	2026-06-25 07:54:43.267314+00	0	1	healthy
5684	1	2026-06-25 07:57:43.266332+00	0	1	healthy
5685	5	2026-06-25 07:57:43.266332+00	0	1	healthy
5686	2	2026-06-25 07:57:43.266332+00	0	1	healthy
5687	3	2026-06-25 07:57:43.266332+00	0	1	healthy
5688	4	2026-06-25 07:57:43.266332+00	0	1	healthy
5699	1	2026-06-25 08:00:43.264954+00	0	1	healthy
5700	5	2026-06-25 08:00:43.264954+00	0	1	healthy
5701	2	2026-06-25 08:00:43.264954+00	0	1	healthy
5702	3	2026-06-25 08:00:43.264954+00	0	1	healthy
5703	4	2026-06-25 08:00:43.264954+00	0	1	healthy
5734	1	2026-06-25 08:07:43.265547+00	0	1	healthy
5735	5	2026-06-25 08:07:43.265547+00	0	1	healthy
5736	2	2026-06-25 08:07:43.265547+00	0	1	healthy
5737	3	2026-06-25 08:07:43.265547+00	0	1	healthy
5738	4	2026-06-25 08:07:43.265547+00	0	1	healthy
7189	1	2026-06-26 02:30:43.265743+00	0	1	healthy
7190	5	2026-06-26 02:30:43.265743+00	0	1	healthy
7191	2	2026-06-26 02:30:43.265743+00	0	1	healthy
7192	3	2026-06-26 02:30:43.265743+00	0	1	healthy
7193	4	2026-06-26 02:30:43.265743+00	0	1	healthy
7199	1	2026-06-26 02:32:43.264986+00	0	1	healthy
7200	5	2026-06-26 02:32:43.264986+00	0	1	healthy
7201	2	2026-06-26 02:32:43.264986+00	0	1	healthy
7202	3	2026-06-26 02:32:43.264986+00	0	1	healthy
7203	4	2026-06-26 02:32:43.264986+00	0	1	healthy
7234	1	2026-06-26 02:39:43.268111+00	0	1	healthy
7235	5	2026-06-26 02:39:43.268111+00	0	1	healthy
7236	2	2026-06-26 02:39:43.268111+00	0	1	healthy
7237	3	2026-06-26 02:39:43.268111+00	0	1	healthy
7238	4	2026-06-26 02:39:43.268111+00	0	1	healthy
5254	1	2026-06-25 06:31:43.266093+00	0	1	healthy
5255	5	2026-06-25 06:31:43.266093+00	0	1	healthy
5256	2	2026-06-25 06:31:43.266093+00	0	1	healthy
5257	3	2026-06-25 06:31:43.266093+00	0	1	healthy
5258	4	2026-06-25 06:31:43.266093+00	0	1	healthy
5264	1	2026-06-25 06:33:43.264729+00	0	1	healthy
5265	5	2026-06-25 06:33:43.264729+00	0	1	healthy
5266	2	2026-06-25 06:33:43.264729+00	0	1	healthy
5267	3	2026-06-25 06:33:43.264729+00	0	1	healthy
5268	4	2026-06-25 06:33:43.264729+00	0	1	healthy
5279	1	2026-06-25 06:36:43.265683+00	0	1	healthy
5280	5	2026-06-25 06:36:43.265683+00	0	1	healthy
5281	2	2026-06-25 06:36:43.265683+00	0	1	healthy
5282	3	2026-06-25 06:36:43.265683+00	0	1	healthy
5283	4	2026-06-25 06:36:43.265683+00	0	1	healthy
5294	1	2026-06-25 06:39:43.267169+00	0	1	healthy
5295	5	2026-06-25 06:39:43.267169+00	0	1	healthy
5296	2	2026-06-25 06:39:43.267169+00	0	1	healthy
5297	3	2026-06-25 06:39:43.267169+00	0	1	healthy
5298	4	2026-06-25 06:39:43.267169+00	0	1	healthy
5309	1	2026-06-25 06:42:43.264398+00	0	1	healthy
5310	5	2026-06-25 06:42:43.264398+00	0	1	healthy
5311	2	2026-06-25 06:42:43.264398+00	0	1	healthy
5312	3	2026-06-25 06:42:43.264398+00	0	1	healthy
5313	4	2026-06-25 06:42:43.264398+00	0	1	healthy
5324	1	2026-06-25 06:45:43.264939+00	0	1	healthy
5325	5	2026-06-25 06:45:43.264939+00	0	1	healthy
5326	2	2026-06-25 06:45:43.264939+00	0	1	healthy
5327	3	2026-06-25 06:45:43.264939+00	0	1	healthy
5328	4	2026-06-25 06:45:43.264939+00	0	1	healthy
5339	1	2026-06-25 06:48:43.265993+00	0	1	healthy
5340	5	2026-06-25 06:48:43.265993+00	0	1	healthy
5341	2	2026-06-25 06:48:43.265993+00	0	1	healthy
5342	3	2026-06-25 06:48:43.265993+00	0	1	healthy
5343	4	2026-06-25 06:48:43.265993+00	0	1	healthy
7254	1	2026-06-26 02:43:43.265126+00	0	1	healthy
7255	5	2026-06-26 02:43:43.265126+00	0	1	healthy
7256	2	2026-06-26 02:43:43.265126+00	0	1	healthy
7257	3	2026-06-26 02:43:43.265126+00	0	1	healthy
7258	4	2026-06-26 02:43:43.265126+00	0	1	healthy
7269	1	2026-06-26 02:46:43.265464+00	0	1	healthy
7270	5	2026-06-26 02:46:43.265464+00	0	1	healthy
7271	2	2026-06-26 02:46:43.265464+00	0	1	healthy
7272	3	2026-06-26 02:46:43.265464+00	0	1	healthy
7273	4	2026-06-26 02:46:43.265464+00	0	1	healthy
7279	1	2026-06-26 02:48:43.2652+00	0	1	healthy
7280	5	2026-06-26 02:48:43.2652+00	0	1	healthy
7281	2	2026-06-26 02:48:43.2652+00	0	1	healthy
7282	3	2026-06-26 02:48:43.2652+00	0	1	healthy
7283	4	2026-06-26 02:48:43.2652+00	0	1	healthy
7309	1	2026-06-26 02:54:43.266279+00	0	1	healthy
7310	5	2026-06-26 02:54:43.266279+00	0	1	healthy
7311	2	2026-06-26 02:54:43.266279+00	0	1	healthy
7312	3	2026-06-26 02:54:43.266279+00	0	1	healthy
7313	4	2026-06-26 02:54:43.266279+00	0	1	healthy
7329	1	2026-06-26 02:58:43.26525+00	0	1	healthy
7330	5	2026-06-26 02:58:43.26525+00	0	1	healthy
7331	2	2026-06-26 02:58:43.26525+00	0	1	healthy
7332	3	2026-06-26 02:58:43.26525+00	0	1	healthy
7333	4	2026-06-26 02:58:43.26525+00	0	1	healthy
7339	1	2026-06-26 03:00:43.265424+00	0	1	healthy
7340	5	2026-06-26 03:00:43.265424+00	0	1	healthy
7341	2	2026-06-26 03:00:43.265424+00	0	1	healthy
7342	3	2026-06-26 03:00:43.265424+00	0	1	healthy
7343	4	2026-06-26 03:00:43.265424+00	0	1	healthy
7344	1	2026-06-26 03:01:43.264381+00	0	1	healthy
7345	5	2026-06-26 03:01:43.264381+00	0	1	healthy
7346	2	2026-06-26 03:01:43.264381+00	0	1	healthy
7347	3	2026-06-26 03:01:43.264381+00	0	1	healthy
7348	4	2026-06-26 03:01:43.264381+00	0	1	healthy
7359	1	2026-06-26 03:04:43.264511+00	0	1	healthy
7360	5	2026-06-26 03:04:43.264511+00	0	1	healthy
7361	2	2026-06-26 03:04:43.264511+00	0	1	healthy
7362	3	2026-06-26 03:04:43.264511+00	0	1	healthy
7363	4	2026-06-26 03:04:43.264511+00	0	1	healthy
7364	1	2026-06-26 03:05:43.265473+00	0	1	healthy
7365	5	2026-06-26 03:05:43.265473+00	0	1	healthy
7366	2	2026-06-26 03:05:43.265473+00	0	1	healthy
7367	3	2026-06-26 03:05:43.265473+00	0	1	healthy
7368	4	2026-06-26 03:05:43.265473+00	0	1	healthy
7384	1	2026-06-26 03:09:43.268413+00	0	1	healthy
7385	5	2026-06-26 03:09:43.268413+00	0	1	healthy
7386	2	2026-06-26 03:09:43.268413+00	0	1	healthy
7387	3	2026-06-26 03:09:43.268413+00	0	1	healthy
7388	4	2026-06-26 03:09:43.268413+00	0	1	healthy
7399	1	2026-06-26 03:12:43.367369+00	0	1	healthy
7400	5	2026-06-26 03:12:43.367369+00	0	1	healthy
7401	2	2026-06-26 03:12:43.367369+00	0	1	healthy
7402	3	2026-06-26 03:12:43.367369+00	0	1	healthy
7403	4	2026-06-26 03:12:43.367369+00	0	1	healthy
5269	1	2026-06-25 06:34:43.266492+00	0	1	healthy
5270	5	2026-06-25 06:34:43.266492+00	0	1	healthy
5271	2	2026-06-25 06:34:43.266492+00	0	1	healthy
5272	3	2026-06-25 06:34:43.266492+00	0	1	healthy
5273	4	2026-06-25 06:34:43.266492+00	0	1	healthy
5289	1	2026-06-25 06:38:43.272409+00	0	1	healthy
5290	5	2026-06-25 06:38:43.272409+00	0	1	healthy
5291	2	2026-06-25 06:38:43.272409+00	0	1	healthy
5292	3	2026-06-25 06:38:43.272409+00	0	1	healthy
5293	4	2026-06-25 06:38:43.272409+00	0	1	healthy
5319	1	2026-06-25 06:44:43.266127+00	0	1	healthy
5320	5	2026-06-25 06:44:43.266127+00	0	1	healthy
5321	2	2026-06-25 06:44:43.266127+00	0	1	healthy
5322	3	2026-06-25 06:44:43.266127+00	0	1	healthy
5323	4	2026-06-25 06:44:43.266127+00	0	1	healthy
5344	1	2026-06-25 06:49:43.266368+00	0	1	healthy
5345	5	2026-06-25 06:49:43.266368+00	0	1	healthy
5346	2	2026-06-25 06:49:43.266368+00	0	1	healthy
5347	3	2026-06-25 06:49:43.266368+00	0	1	healthy
5348	4	2026-06-25 06:49:43.266368+00	0	1	healthy
5359	1	2026-06-25 06:52:43.300173+00	0	1	healthy
5360	5	2026-06-25 06:52:43.300173+00	0	1	healthy
5361	2	2026-06-25 06:52:43.300173+00	0	1	healthy
5362	3	2026-06-25 06:52:43.300173+00	0	1	healthy
5363	4	2026-06-25 06:52:43.300173+00	0	1	healthy
5374	1	2026-06-25 06:55:43.264959+00	0	1	healthy
5375	5	2026-06-25 06:55:43.264959+00	0	1	healthy
5376	2	2026-06-25 06:55:43.264959+00	0	1	healthy
5377	3	2026-06-25 06:55:43.264959+00	0	1	healthy
5378	4	2026-06-25 06:55:43.264959+00	0	1	healthy
5394	1	2026-06-25 06:59:43.268192+00	0	1	healthy
5395	5	2026-06-25 06:59:43.268192+00	0	1	healthy
5396	2	2026-06-25 06:59:43.268192+00	0	1	healthy
5397	3	2026-06-25 06:59:43.268192+00	0	1	healthy
5398	4	2026-06-25 06:59:43.268192+00	0	1	healthy
5409	1	2026-06-25 07:02:43.264461+00	0	1	healthy
5410	5	2026-06-25 07:02:43.264461+00	0	1	healthy
5411	2	2026-06-25 07:02:43.264461+00	0	1	healthy
5412	3	2026-06-25 07:02:43.264461+00	0	1	healthy
5413	4	2026-06-25 07:02:43.264461+00	0	1	healthy
5424	1	2026-06-25 07:05:43.265818+00	0	1	healthy
5425	5	2026-06-25 07:05:43.265818+00	0	1	healthy
5426	2	2026-06-25 07:05:43.265818+00	0	1	healthy
5427	3	2026-06-25 07:05:43.265818+00	0	1	healthy
5428	4	2026-06-25 07:05:43.265818+00	0	1	healthy
5449	1	2026-06-25 07:10:43.264359+00	0	1	healthy
5450	5	2026-06-25 07:10:43.264359+00	0	1	healthy
5451	2	2026-06-25 07:10:43.264359+00	0	1	healthy
5452	3	2026-06-25 07:10:43.264359+00	0	1	healthy
5453	4	2026-06-25 07:10:43.264359+00	0	1	healthy
5484	1	2026-06-25 07:17:43.264871+00	0	1	healthy
5485	5	2026-06-25 07:17:43.264871+00	0	1	healthy
5486	2	2026-06-25 07:17:43.264871+00	0	1	healthy
5487	3	2026-06-25 07:17:43.264871+00	0	1	healthy
5488	4	2026-06-25 07:17:43.264871+00	0	1	healthy
5509	1	2026-06-25 07:22:43.264996+00	0	1	healthy
5510	5	2026-06-25 07:22:43.264996+00	0	1	healthy
5511	2	2026-06-25 07:22:43.264996+00	0	1	healthy
5512	3	2026-06-25 07:22:43.264996+00	0	1	healthy
5513	4	2026-06-25 07:22:43.264996+00	0	1	healthy
5524	1	2026-06-25 07:25:43.264395+00	0	1	healthy
5525	5	2026-06-25 07:25:43.264395+00	0	1	healthy
5526	2	2026-06-25 07:25:43.264395+00	0	1	healthy
5527	3	2026-06-25 07:25:43.264395+00	0	1	healthy
5528	4	2026-06-25 07:25:43.264395+00	0	1	healthy
5534	1	2026-06-25 07:27:43.265089+00	0	1	healthy
5535	5	2026-06-25 07:27:43.265089+00	0	1	healthy
5536	2	2026-06-25 07:27:43.265089+00	0	1	healthy
5537	3	2026-06-25 07:27:43.265089+00	0	1	healthy
5538	4	2026-06-25 07:27:43.265089+00	0	1	healthy
5569	1	2026-06-25 07:34:43.266566+00	0	1	healthy
5570	5	2026-06-25 07:34:43.266566+00	0	1	healthy
5571	2	2026-06-25 07:34:43.266566+00	0	1	healthy
5572	3	2026-06-25 07:34:43.266566+00	0	1	healthy
5573	4	2026-06-25 07:34:43.266566+00	0	1	healthy
5574	1	2026-06-25 07:35:43.265513+00	0	1	healthy
5575	5	2026-06-25 07:35:43.265513+00	0	1	healthy
5576	2	2026-06-25 07:35:43.265513+00	0	1	healthy
5577	3	2026-06-25 07:35:43.265513+00	0	1	healthy
5578	4	2026-06-25 07:35:43.265513+00	0	1	healthy
7414	1	2026-06-26 03:15:43.266289+00	0	1	healthy
7415	5	2026-06-26 03:15:43.266289+00	0	1	healthy
7416	2	2026-06-26 03:15:43.266289+00	0	1	healthy
7417	3	2026-06-26 03:15:43.266289+00	0	1	healthy
7418	4	2026-06-26 03:15:43.266289+00	0	1	healthy
7419	1	2026-06-26 03:31:43.826023+00	0	1	healthy
7420	5	2026-06-26 03:31:43.826023+00	0	1	healthy
7421	2	2026-06-26 03:31:43.826023+00	0	1	healthy
7422	3	2026-06-26 03:31:43.826023+00	0	1	healthy
7423	4	2026-06-26 03:31:43.826023+00	0	1	healthy
5284	1	2026-06-25 06:37:43.304269+00	0	1	healthy
5285	5	2026-06-25 06:37:43.304269+00	0	1	healthy
5286	2	2026-06-25 06:37:43.304269+00	0	1	healthy
5287	3	2026-06-25 06:37:43.304269+00	0	1	healthy
5288	4	2026-06-25 06:37:43.304269+00	0	1	healthy
5299	1	2026-06-25 06:40:43.265473+00	0	1	healthy
5300	5	2026-06-25 06:40:43.265473+00	0	1	healthy
5301	2	2026-06-25 06:40:43.265473+00	0	1	healthy
5302	3	2026-06-25 06:40:43.265473+00	0	1	healthy
5303	4	2026-06-25 06:40:43.265473+00	0	1	healthy
5354	1	2026-06-25 06:51:43.266431+00	0	1	healthy
5355	5	2026-06-25 06:51:43.266431+00	0	1	healthy
5356	2	2026-06-25 06:51:43.266431+00	0	1	healthy
5357	3	2026-06-25 06:51:43.266431+00	0	1	healthy
5358	4	2026-06-25 06:51:43.266431+00	0	1	healthy
5404	1	2026-06-25 07:01:43.266161+00	0	1	healthy
5405	5	2026-06-25 07:01:43.266161+00	0	1	healthy
5406	2	2026-06-25 07:01:43.266161+00	0	1	healthy
5407	3	2026-06-25 07:01:43.266161+00	0	1	healthy
5408	4	2026-06-25 07:01:43.266161+00	0	1	healthy
5454	1	2026-06-25 07:11:43.265111+00	0	1	healthy
5455	5	2026-06-25 07:11:43.265111+00	0	1	healthy
5456	2	2026-06-25 07:11:43.265111+00	0	1	healthy
5457	3	2026-06-25 07:11:43.265111+00	0	1	healthy
5458	4	2026-06-25 07:11:43.265111+00	0	1	healthy
5519	1	2026-06-25 07:24:43.268119+00	0	1	healthy
5520	5	2026-06-25 07:24:43.268119+00	0	1	healthy
5521	2	2026-06-25 07:24:43.268119+00	0	1	healthy
5522	3	2026-06-25 07:24:43.268119+00	0	1	healthy
5523	4	2026-06-25 07:24:43.268119+00	0	1	healthy
5559	1	2026-06-25 07:32:43.264833+00	0	1	healthy
5560	5	2026-06-25 07:32:43.264833+00	0	1	healthy
5561	2	2026-06-25 07:32:43.264833+00	0	1	healthy
5562	3	2026-06-25 07:32:43.264833+00	0	1	healthy
5563	4	2026-06-25 07:32:43.264833+00	0	1	healthy
5599	1	2026-06-25 07:40:43.265342+00	0	1	healthy
5600	5	2026-06-25 07:40:43.265342+00	0	1	healthy
5601	2	2026-06-25 07:40:43.265342+00	0	1	healthy
5602	3	2026-06-25 07:40:43.265342+00	0	1	healthy
5603	4	2026-06-25 07:40:43.265342+00	0	1	healthy
5629	1	2026-06-25 07:46:43.265657+00	0	1	healthy
5630	5	2026-06-25 07:46:43.265657+00	0	1	healthy
5631	2	2026-06-25 07:46:43.265657+00	0	1	healthy
5632	3	2026-06-25 07:46:43.265657+00	0	1	healthy
5633	4	2026-06-25 07:46:43.265657+00	0	1	healthy
5654	1	2026-06-25 07:51:43.265079+00	0	1	healthy
5655	5	2026-06-25 07:51:43.265079+00	0	1	healthy
5656	2	2026-06-25 07:51:43.265079+00	0	1	healthy
5657	3	2026-06-25 07:51:43.265079+00	0	1	healthy
5658	4	2026-06-25 07:51:43.265079+00	0	1	healthy
5719	1	2026-06-25 08:04:43.266571+00	0	1	healthy
5720	5	2026-06-25 08:04:43.266571+00	0	1	healthy
5721	2	2026-06-25 08:04:43.266571+00	0	1	healthy
5722	3	2026-06-25 08:04:43.266571+00	0	1	healthy
5723	4	2026-06-25 08:04:43.266571+00	0	1	healthy
7424	1	2026-06-26 04:01:43.806336+00	0	1	healthy
7425	5	2026-06-26 04:01:43.806336+00	0	1	healthy
7426	2	2026-06-26 04:01:43.806336+00	0	1	healthy
7427	3	2026-06-26 04:01:43.806336+00	0	1	healthy
7428	4	2026-06-26 04:01:43.806336+00	0	1	healthy
5314	1	2026-06-25 06:43:43.266006+00	0	1	healthy
5315	5	2026-06-25 06:43:43.266006+00	0	1	healthy
5316	2	2026-06-25 06:43:43.266006+00	0	1	healthy
5317	3	2026-06-25 06:43:43.266006+00	0	1	healthy
5318	4	2026-06-25 06:43:43.266006+00	0	1	healthy
5329	1	2026-06-25 06:46:43.26569+00	0	1	healthy
5330	5	2026-06-25 06:46:43.26569+00	0	1	healthy
5331	2	2026-06-25 06:46:43.26569+00	0	1	healthy
5332	3	2026-06-25 06:46:43.26569+00	0	1	healthy
5333	4	2026-06-25 06:46:43.26569+00	0	1	healthy
5334	1	2026-06-25 06:47:43.267135+00	0	1	healthy
5335	5	2026-06-25 06:47:43.267135+00	0	1	healthy
5336	2	2026-06-25 06:47:43.267135+00	0	1	healthy
5337	3	2026-06-25 06:47:43.267135+00	0	1	healthy
5338	4	2026-06-25 06:47:43.267135+00	0	1	healthy
5349	1	2026-06-25 06:50:43.26571+00	0	1	healthy
5350	5	2026-06-25 06:50:43.26571+00	0	1	healthy
5351	2	2026-06-25 06:50:43.26571+00	0	1	healthy
5352	3	2026-06-25 06:50:43.26571+00	0	1	healthy
5353	4	2026-06-25 06:50:43.26571+00	0	1	healthy
5364	1	2026-06-25 06:53:43.271363+00	0	1	healthy
5365	5	2026-06-25 06:53:43.271363+00	0	1	healthy
5366	2	2026-06-25 06:53:43.271363+00	0	1	healthy
5367	3	2026-06-25 06:53:43.271363+00	0	1	healthy
5368	4	2026-06-25 06:53:43.271363+00	0	1	healthy
5379	1	2026-06-25 06:56:43.265746+00	0	1	healthy
5380	5	2026-06-25 06:56:43.265746+00	0	1	healthy
5381	2	2026-06-25 06:56:43.265746+00	0	1	healthy
5382	3	2026-06-25 06:56:43.265746+00	0	1	healthy
5383	4	2026-06-25 06:56:43.265746+00	0	1	healthy
5384	1	2026-06-25 06:57:43.265858+00	0	1	healthy
5385	5	2026-06-25 06:57:43.265858+00	0	1	healthy
5386	2	2026-06-25 06:57:43.265858+00	0	1	healthy
5387	3	2026-06-25 06:57:43.265858+00	0	1	healthy
5388	4	2026-06-25 06:57:43.265858+00	0	1	healthy
5414	1	2026-06-25 07:03:43.264451+00	0	1	healthy
5415	5	2026-06-25 07:03:43.264451+00	0	1	healthy
5416	2	2026-06-25 07:03:43.264451+00	0	1	healthy
5417	3	2026-06-25 07:03:43.264451+00	0	1	healthy
5418	4	2026-06-25 07:03:43.264451+00	0	1	healthy
5419	1	2026-06-25 07:04:43.266284+00	0	1	healthy
5420	5	2026-06-25 07:04:43.266284+00	0	1	healthy
5421	2	2026-06-25 07:04:43.266284+00	0	1	healthy
5422	3	2026-06-25 07:04:43.266284+00	0	1	healthy
5423	4	2026-06-25 07:04:43.266284+00	0	1	healthy
5429	1	2026-06-25 07:06:43.264945+00	0	1	healthy
5430	5	2026-06-25 07:06:43.264945+00	0	1	healthy
5431	2	2026-06-25 07:06:43.264945+00	0	1	healthy
5432	3	2026-06-25 07:06:43.264945+00	0	1	healthy
5433	4	2026-06-25 07:06:43.264945+00	0	1	healthy
5439	1	2026-06-25 07:08:43.319624+00	0	1	healthy
5440	5	2026-06-25 07:08:43.319624+00	0	1	healthy
5441	2	2026-06-25 07:08:43.319624+00	0	1	healthy
5442	3	2026-06-25 07:08:43.319624+00	0	1	healthy
5443	4	2026-06-25 07:08:43.319624+00	0	1	healthy
5444	1	2026-06-25 07:09:43.266643+00	0	1	healthy
5445	5	2026-06-25 07:09:43.266643+00	0	1	healthy
5446	2	2026-06-25 07:09:43.266643+00	0	1	healthy
5447	3	2026-06-25 07:09:43.266643+00	0	1	healthy
5448	4	2026-06-25 07:09:43.266643+00	0	1	healthy
5464	1	2026-06-25 07:13:43.265172+00	0	1	healthy
5465	5	2026-06-25 07:13:43.265172+00	0	1	healthy
5466	2	2026-06-25 07:13:43.265172+00	0	1	healthy
5467	3	2026-06-25 07:13:43.265172+00	0	1	healthy
5468	4	2026-06-25 07:13:43.265172+00	0	1	healthy
5469	1	2026-06-25 07:14:43.26648+00	0	1	healthy
5470	5	2026-06-25 07:14:43.26648+00	0	1	healthy
5471	2	2026-06-25 07:14:43.26648+00	0	1	healthy
5472	3	2026-06-25 07:14:43.26648+00	0	1	healthy
5473	4	2026-06-25 07:14:43.26648+00	0	1	healthy
5479	1	2026-06-25 07:16:43.264442+00	0	1	healthy
5480	5	2026-06-25 07:16:43.264442+00	0	1	healthy
5481	2	2026-06-25 07:16:43.264442+00	0	1	healthy
5482	3	2026-06-25 07:16:43.264442+00	0	1	healthy
5483	4	2026-06-25 07:16:43.264442+00	0	1	healthy
5489	1	2026-06-25 07:18:43.265529+00	0	1	healthy
5490	5	2026-06-25 07:18:43.265529+00	0	1	healthy
5491	2	2026-06-25 07:18:43.265529+00	0	1	healthy
5492	3	2026-06-25 07:18:43.265529+00	0	1	healthy
5493	4	2026-06-25 07:18:43.265529+00	0	1	healthy
5494	1	2026-06-25 07:19:43.265265+00	0	1	healthy
5495	5	2026-06-25 07:19:43.265265+00	0	1	healthy
5496	2	2026-06-25 07:19:43.265265+00	0	1	healthy
5497	3	2026-06-25 07:19:43.265265+00	0	1	healthy
5498	4	2026-06-25 07:19:43.265265+00	0	1	healthy
5499	1	2026-06-25 07:20:43.264306+00	0	1	healthy
5500	5	2026-06-25 07:20:43.264306+00	0	1	healthy
5501	2	2026-06-25 07:20:43.264306+00	0	1	healthy
5502	3	2026-06-25 07:20:43.264306+00	0	1	healthy
5503	4	2026-06-25 07:20:43.264306+00	0	1	healthy
5514	1	2026-06-25 07:23:43.280594+00	0	1	healthy
5515	5	2026-06-25 07:23:43.280594+00	0	1	healthy
5516	2	2026-06-25 07:23:43.280594+00	0	1	healthy
5517	3	2026-06-25 07:23:43.280594+00	0	1	healthy
5518	4	2026-06-25 07:23:43.280594+00	0	1	healthy
5529	1	2026-06-25 07:26:43.265922+00	0	1	healthy
5530	5	2026-06-25 07:26:43.265922+00	0	1	healthy
5531	2	2026-06-25 07:26:43.265922+00	0	1	healthy
5532	3	2026-06-25 07:26:43.265922+00	0	1	healthy
5533	4	2026-06-25 07:26:43.265922+00	0	1	healthy
5539	1	2026-06-25 07:28:43.264594+00	0	1	healthy
5540	5	2026-06-25 07:28:43.264594+00	0	1	healthy
5541	2	2026-06-25 07:28:43.264594+00	0	1	healthy
5542	3	2026-06-25 07:28:43.264594+00	0	1	healthy
5543	4	2026-06-25 07:28:43.264594+00	0	1	healthy
5549	1	2026-06-25 07:30:43.265848+00	0	1	healthy
5550	5	2026-06-25 07:30:43.265848+00	0	1	healthy
5551	2	2026-06-25 07:30:43.265848+00	0	1	healthy
5552	3	2026-06-25 07:30:43.265848+00	0	1	healthy
5553	4	2026-06-25 07:30:43.265848+00	0	1	healthy
5554	1	2026-06-25 07:31:43.266319+00	0	1	healthy
5555	5	2026-06-25 07:31:43.266319+00	0	1	healthy
5556	2	2026-06-25 07:31:43.266319+00	0	1	healthy
5557	3	2026-06-25 07:31:43.266319+00	0	1	healthy
5558	4	2026-06-25 07:31:43.266319+00	0	1	healthy
5584	1	2026-06-25 07:37:43.265781+00	0	1	healthy
5585	5	2026-06-25 07:37:43.265781+00	0	1	healthy
5586	2	2026-06-25 07:37:43.265781+00	0	1	healthy
5587	3	2026-06-25 07:37:43.265781+00	0	1	healthy
5588	4	2026-06-25 07:37:43.265781+00	0	1	healthy
5589	1	2026-06-25 07:38:43.298319+00	0	1	healthy
5590	5	2026-06-25 07:38:43.298319+00	0	1	healthy
5591	2	2026-06-25 07:38:43.298319+00	0	1	healthy
5592	3	2026-06-25 07:38:43.298319+00	0	1	healthy
5593	4	2026-06-25 07:38:43.298319+00	0	1	healthy
5604	1	2026-06-25 07:41:43.265782+00	0	1	healthy
5605	5	2026-06-25 07:41:43.265782+00	0	1	healthy
5606	2	2026-06-25 07:41:43.265782+00	0	1	healthy
5607	3	2026-06-25 07:41:43.265782+00	0	1	healthy
5608	4	2026-06-25 07:41:43.265782+00	0	1	healthy
5614	1	2026-06-25 07:43:43.265185+00	0	1	healthy
5615	5	2026-06-25 07:43:43.265185+00	0	1	healthy
5616	2	2026-06-25 07:43:43.265185+00	0	1	healthy
5617	3	2026-06-25 07:43:43.265185+00	0	1	healthy
5618	4	2026-06-25 07:43:43.265185+00	0	1	healthy
5624	1	2026-06-25 07:45:43.265523+00	0	1	healthy
5625	5	2026-06-25 07:45:43.265523+00	0	1	healthy
5626	2	2026-06-25 07:45:43.265523+00	0	1	healthy
5627	3	2026-06-25 07:45:43.265523+00	0	1	healthy
5628	4	2026-06-25 07:45:43.265523+00	0	1	healthy
5639	1	2026-06-25 07:48:43.266305+00	0	1	healthy
5640	5	2026-06-25 07:48:43.266305+00	0	1	healthy
5641	2	2026-06-25 07:48:43.266305+00	0	1	healthy
5642	3	2026-06-25 07:48:43.266305+00	0	1	healthy
5643	4	2026-06-25 07:48:43.266305+00	0	1	healthy
5644	1	2026-06-25 07:49:43.267219+00	0	1	healthy
5645	5	2026-06-25 07:49:43.267219+00	0	1	healthy
5646	2	2026-06-25 07:49:43.267219+00	0	1	healthy
5647	3	2026-06-25 07:49:43.267219+00	0	1	healthy
5648	4	2026-06-25 07:49:43.267219+00	0	1	healthy
5649	1	2026-06-25 07:50:43.265843+00	0	1	healthy
5650	5	2026-06-25 07:50:43.265843+00	0	1	healthy
5651	2	2026-06-25 07:50:43.265843+00	0	1	healthy
5652	3	2026-06-25 07:50:43.265843+00	0	1	healthy
5653	4	2026-06-25 07:50:43.265843+00	0	1	healthy
5659	1	2026-06-25 07:52:43.264775+00	0	1	healthy
5660	5	2026-06-25 07:52:43.264775+00	0	1	healthy
5661	2	2026-06-25 07:52:43.264775+00	0	1	healthy
5662	3	2026-06-25 07:52:43.264775+00	0	1	healthy
5663	4	2026-06-25 07:52:43.264775+00	0	1	healthy
5674	1	2026-06-25 07:55:43.26496+00	0	1	healthy
5675	5	2026-06-25 07:55:43.26496+00	0	1	healthy
5676	2	2026-06-25 07:55:43.26496+00	0	1	healthy
5677	3	2026-06-25 07:55:43.26496+00	0	1	healthy
5678	4	2026-06-25 07:55:43.26496+00	0	1	healthy
5689	1	2026-06-25 07:58:43.423299+00	0	1	healthy
5690	5	2026-06-25 07:58:43.423299+00	0	1	healthy
5691	2	2026-06-25 07:58:43.423299+00	0	1	healthy
5692	3	2026-06-25 07:58:43.423299+00	0	1	healthy
5693	4	2026-06-25 07:58:43.423299+00	0	1	healthy
5704	1	2026-06-25 08:01:43.265412+00	0	1	healthy
5705	5	2026-06-25 08:01:43.265412+00	0	1	healthy
5706	2	2026-06-25 08:01:43.265412+00	0	1	healthy
5707	3	2026-06-25 08:01:43.265412+00	0	1	healthy
5708	4	2026-06-25 08:01:43.265412+00	0	1	healthy
5709	1	2026-06-25 08:02:43.264726+00	0	1	healthy
5710	5	2026-06-25 08:02:43.264726+00	0	1	healthy
5711	2	2026-06-25 08:02:43.264726+00	0	1	healthy
5712	3	2026-06-25 08:02:43.264726+00	0	1	healthy
5713	4	2026-06-25 08:02:43.264726+00	0	1	healthy
5724	1	2026-06-25 08:05:43.26586+00	0	1	healthy
5725	5	2026-06-25 08:05:43.26586+00	0	1	healthy
5726	2	2026-06-25 08:05:43.26586+00	0	1	healthy
5727	3	2026-06-25 08:05:43.26586+00	0	1	healthy
5728	4	2026-06-25 08:05:43.26586+00	0	1	healthy
5739	1	2026-06-25 08:08:43.266491+00	0	1	healthy
5740	5	2026-06-25 08:08:43.266491+00	0	1	healthy
5741	2	2026-06-25 08:08:43.266491+00	0	1	healthy
5742	3	2026-06-25 08:08:43.266491+00	0	1	healthy
5743	4	2026-06-25 08:08:43.266491+00	0	1	healthy
7429	1	2026-06-26 04:16:43.842698+00	0	1	healthy
7430	5	2026-06-26 04:16:43.842698+00	0	1	healthy
7431	2	2026-06-26 04:16:43.842698+00	0	1	healthy
7432	3	2026-06-26 04:16:43.842698+00	0	1	healthy
7433	4	2026-06-26 04:16:43.842698+00	0	1	healthy
7449	1	2026-06-26 06:31:43.806823+00	0	1	healthy
7450	5	2026-06-26 06:31:43.806823+00	0	1	healthy
7451	2	2026-06-26 06:31:43.806823+00	0	1	healthy
7452	3	2026-06-26 06:31:43.806823+00	0	1	healthy
7453	4	2026-06-26 06:31:43.806823+00	0	1	healthy
7454	1	2026-06-26 06:46:43.812342+00	0	1	healthy
7455	5	2026-06-26 06:46:43.812342+00	0	1	healthy
7456	2	2026-06-26 06:46:43.812342+00	0	1	healthy
7457	3	2026-06-26 06:46:43.812342+00	0	1	healthy
7458	4	2026-06-26 06:46:43.812342+00	0	1	healthy
5609	1	2026-06-25 07:42:43.265116+00	0	1	healthy
5610	5	2026-06-25 07:42:43.265116+00	0	1	healthy
5611	2	2026-06-25 07:42:43.265116+00	0	1	healthy
5612	3	2026-06-25 07:42:43.265116+00	0	1	healthy
5613	4	2026-06-25 07:42:43.265116+00	0	1	healthy
5664	1	2026-06-25 07:53:43.363537+00	0	1	healthy
5665	5	2026-06-25 07:53:43.363537+00	0	1	healthy
5666	2	2026-06-25 07:53:43.363537+00	0	1	healthy
5667	3	2026-06-25 07:53:43.363537+00	0	1	healthy
5668	4	2026-06-25 07:53:43.363537+00	0	1	healthy
5679	1	2026-06-25 07:56:43.264338+00	0	1	healthy
5680	5	2026-06-25 07:56:43.264338+00	0	1	healthy
5681	2	2026-06-25 07:56:43.264338+00	0	1	healthy
5682	3	2026-06-25 07:56:43.264338+00	0	1	healthy
5683	4	2026-06-25 07:56:43.264338+00	0	1	healthy
5694	1	2026-06-25 07:59:43.265633+00	0	1	healthy
5695	5	2026-06-25 07:59:43.265633+00	0	1	healthy
5696	2	2026-06-25 07:59:43.265633+00	0	1	healthy
5697	3	2026-06-25 07:59:43.265633+00	0	1	healthy
5698	4	2026-06-25 07:59:43.265633+00	0	1	healthy
5714	1	2026-06-25 08:03:43.265661+00	0	1	healthy
5715	5	2026-06-25 08:03:43.265661+00	0	1	healthy
5716	2	2026-06-25 08:03:43.265661+00	0	1	healthy
5717	3	2026-06-25 08:03:43.265661+00	0	1	healthy
5718	4	2026-06-25 08:03:43.265661+00	0	1	healthy
5729	1	2026-06-25 08:06:43.264939+00	0	1	healthy
5730	5	2026-06-25 08:06:43.264939+00	0	1	healthy
5731	2	2026-06-25 08:06:43.264939+00	0	1	healthy
5732	3	2026-06-25 08:06:43.264939+00	0	1	healthy
5733	4	2026-06-25 08:06:43.264939+00	0	1	healthy
5744	1	2026-06-25 08:09:43.299996+00	0	1	healthy
5745	5	2026-06-25 08:09:43.299996+00	0	1	healthy
5746	2	2026-06-25 08:09:43.299996+00	0	1	healthy
5747	3	2026-06-25 08:09:43.299996+00	0	1	healthy
5748	4	2026-06-25 08:09:43.299996+00	0	1	healthy
5749	1	2026-06-25 08:10:43.272055+00	0	1	healthy
5750	5	2026-06-25 08:10:43.272055+00	0	1	healthy
5751	2	2026-06-25 08:10:43.272055+00	0	1	healthy
5752	3	2026-06-25 08:10:43.272055+00	0	1	healthy
5753	4	2026-06-25 08:10:43.272055+00	0	1	healthy
5754	1	2026-06-25 08:11:43.265993+00	0	1	healthy
5755	5	2026-06-25 08:11:43.265993+00	0	1	healthy
5756	2	2026-06-25 08:11:43.265993+00	0	1	healthy
5757	3	2026-06-25 08:11:43.265993+00	0	1	healthy
5758	4	2026-06-25 08:11:43.265993+00	0	1	healthy
5759	1	2026-06-25 08:12:43.266544+00	0	1	healthy
5760	5	2026-06-25 08:12:43.266544+00	0	1	healthy
5761	2	2026-06-25 08:12:43.266544+00	0	1	healthy
5762	3	2026-06-25 08:12:43.266544+00	0	1	healthy
5763	4	2026-06-25 08:12:43.266544+00	0	1	healthy
5764	1	2026-06-25 08:13:43.26548+00	0	1	healthy
5765	5	2026-06-25 08:13:43.26548+00	0	1	healthy
5766	2	2026-06-25 08:13:43.26548+00	0	1	healthy
5767	3	2026-06-25 08:13:43.26548+00	0	1	healthy
5768	4	2026-06-25 08:13:43.26548+00	0	1	healthy
5769	1	2026-06-25 08:14:43.265453+00	0	1	healthy
5770	5	2026-06-25 08:14:43.265453+00	0	1	healthy
5771	2	2026-06-25 08:14:43.265453+00	0	1	healthy
5772	3	2026-06-25 08:14:43.265453+00	0	1	healthy
5773	4	2026-06-25 08:14:43.265453+00	0	1	healthy
5774	1	2026-06-25 08:15:43.265391+00	0	1	healthy
5775	5	2026-06-25 08:15:43.265391+00	0	1	healthy
5776	2	2026-06-25 08:15:43.265391+00	0	1	healthy
5777	3	2026-06-25 08:15:43.265391+00	0	1	healthy
5778	4	2026-06-25 08:15:43.265391+00	0	1	healthy
5779	1	2026-06-25 08:16:43.26476+00	0	1	healthy
5780	5	2026-06-25 08:16:43.26476+00	0	1	healthy
5781	2	2026-06-25 08:16:43.26476+00	0	1	healthy
5782	3	2026-06-25 08:16:43.26476+00	0	1	healthy
5783	4	2026-06-25 08:16:43.26476+00	0	1	healthy
5784	1	2026-06-25 08:17:43.265053+00	0	1	healthy
5785	5	2026-06-25 08:17:43.265053+00	0	1	healthy
5786	2	2026-06-25 08:17:43.265053+00	0	1	healthy
5787	3	2026-06-25 08:17:43.265053+00	0	1	healthy
5788	4	2026-06-25 08:17:43.265053+00	0	1	healthy
5789	1	2026-06-25 08:18:43.265483+00	0	1	healthy
5790	5	2026-06-25 08:18:43.265483+00	0	1	healthy
5791	2	2026-06-25 08:18:43.265483+00	0	1	healthy
5792	3	2026-06-25 08:18:43.265483+00	0	1	healthy
5793	4	2026-06-25 08:18:43.265483+00	0	1	healthy
5794	1	2026-06-25 08:19:43.268775+00	0	1	healthy
5795	5	2026-06-25 08:19:43.268775+00	0	1	healthy
5796	2	2026-06-25 08:19:43.268775+00	0	1	healthy
5797	3	2026-06-25 08:19:43.268775+00	0	1	healthy
5798	4	2026-06-25 08:19:43.268775+00	0	1	healthy
5799	1	2026-06-25 08:20:43.2657+00	0	1	healthy
5800	5	2026-06-25 08:20:43.2657+00	0	1	healthy
5801	2	2026-06-25 08:20:43.2657+00	0	1	healthy
5802	3	2026-06-25 08:20:43.2657+00	0	1	healthy
5803	4	2026-06-25 08:20:43.2657+00	0	1	healthy
5804	1	2026-06-25 08:21:43.266257+00	0	1	healthy
5805	5	2026-06-25 08:21:43.266257+00	0	1	healthy
5806	2	2026-06-25 08:21:43.266257+00	0	1	healthy
5807	3	2026-06-25 08:21:43.266257+00	0	1	healthy
5808	4	2026-06-25 08:21:43.266257+00	0	1	healthy
5809	1	2026-06-25 08:22:43.266103+00	0	1	healthy
5810	5	2026-06-25 08:22:43.266103+00	0	1	healthy
5811	2	2026-06-25 08:22:43.266103+00	0	1	healthy
5812	3	2026-06-25 08:22:43.266103+00	0	1	healthy
5813	4	2026-06-25 08:22:43.266103+00	0	1	healthy
5814	1	2026-06-25 08:23:43.265775+00	0	1	healthy
5815	5	2026-06-25 08:23:43.265775+00	0	1	healthy
5816	2	2026-06-25 08:23:43.265775+00	0	1	healthy
5817	3	2026-06-25 08:23:43.265775+00	0	1	healthy
5818	4	2026-06-25 08:23:43.265775+00	0	1	healthy
5819	1	2026-06-25 08:24:43.28291+00	0	1	healthy
5820	5	2026-06-25 08:24:43.28291+00	0	1	healthy
5821	2	2026-06-25 08:24:43.28291+00	0	1	healthy
5822	3	2026-06-25 08:24:43.28291+00	0	1	healthy
5823	4	2026-06-25 08:24:43.28291+00	0	1	healthy
5824	1	2026-06-25 08:25:43.267998+00	0	1	healthy
5825	5	2026-06-25 08:25:43.267998+00	0	1	healthy
5826	2	2026-06-25 08:25:43.267998+00	0	1	healthy
5827	3	2026-06-25 08:25:43.267998+00	0	1	healthy
5828	4	2026-06-25 08:25:43.267998+00	0	1	healthy
5829	1	2026-06-25 08:26:43.265716+00	0	1	healthy
5830	5	2026-06-25 08:26:43.265716+00	0	1	healthy
5831	2	2026-06-25 08:26:43.265716+00	0	1	healthy
5832	3	2026-06-25 08:26:43.265716+00	0	1	healthy
5833	4	2026-06-25 08:26:43.265716+00	0	1	healthy
5834	1	2026-06-25 08:27:43.265427+00	0	1	healthy
5835	5	2026-06-25 08:27:43.265427+00	0	1	healthy
5836	2	2026-06-25 08:27:43.265427+00	0	1	healthy
5837	3	2026-06-25 08:27:43.265427+00	0	1	healthy
5838	4	2026-06-25 08:27:43.265427+00	0	1	healthy
5849	1	2026-06-25 08:30:43.265817+00	0	1	healthy
5850	5	2026-06-25 08:30:43.265817+00	0	1	healthy
5851	2	2026-06-25 08:30:43.265817+00	0	1	healthy
5852	3	2026-06-25 08:30:43.265817+00	0	1	healthy
5853	4	2026-06-25 08:30:43.265817+00	0	1	healthy
5894	1	2026-06-25 08:39:43.267216+00	0	1	healthy
5895	5	2026-06-25 08:39:43.267216+00	0	1	healthy
5896	2	2026-06-25 08:39:43.267216+00	0	1	healthy
5897	3	2026-06-25 08:39:43.267216+00	0	1	healthy
5898	4	2026-06-25 08:39:43.267216+00	0	1	healthy
5914	1	2026-06-25 08:43:43.265526+00	0	1	healthy
5915	5	2026-06-25 08:43:43.265526+00	0	1	healthy
5916	2	2026-06-25 08:43:43.265526+00	0	1	healthy
5917	3	2026-06-25 08:43:43.265526+00	0	1	healthy
5918	4	2026-06-25 08:43:43.265526+00	0	1	healthy
5929	1	2026-06-25 08:46:43.265666+00	0	1	healthy
5930	5	2026-06-25 08:46:43.265666+00	0	1	healthy
5931	2	2026-06-25 08:46:43.265666+00	0	1	healthy
5932	3	2026-06-25 08:46:43.265666+00	0	1	healthy
5933	4	2026-06-25 08:46:43.265666+00	0	1	healthy
5959	1	2026-06-25 08:52:43.26563+00	0	1	healthy
5960	5	2026-06-25 08:52:43.26563+00	0	1	healthy
5961	2	2026-06-25 08:52:43.26563+00	0	1	healthy
5962	3	2026-06-25 08:52:43.26563+00	0	1	healthy
5963	4	2026-06-25 08:52:43.26563+00	0	1	healthy
5974	1	2026-06-25 08:55:43.264822+00	0	1	healthy
5975	5	2026-06-25 08:55:43.264822+00	0	1	healthy
5976	2	2026-06-25 08:55:43.264822+00	0	1	healthy
5977	3	2026-06-25 08:55:43.264822+00	0	1	healthy
5978	4	2026-06-25 08:55:43.264822+00	0	1	healthy
5994	1	2026-06-25 08:59:43.26545+00	0	1	healthy
5995	5	2026-06-25 08:59:43.26545+00	0	1	healthy
5996	2	2026-06-25 08:59:43.26545+00	0	1	healthy
5997	3	2026-06-25 08:59:43.26545+00	0	1	healthy
5998	4	2026-06-25 08:59:43.26545+00	0	1	healthy
6014	1	2026-06-25 09:03:43.266036+00	0	1	healthy
6015	5	2026-06-25 09:03:43.266036+00	0	1	healthy
6016	2	2026-06-25 09:03:43.266036+00	0	1	healthy
6017	3	2026-06-25 09:03:43.266036+00	0	1	healthy
6018	4	2026-06-25 09:03:43.266036+00	0	1	healthy
6029	1	2026-06-25 09:06:43.265318+00	0	1	healthy
6030	5	2026-06-25 09:06:43.265318+00	0	1	healthy
6031	2	2026-06-25 09:06:43.265318+00	0	1	healthy
6032	3	2026-06-25 09:06:43.265318+00	0	1	healthy
6033	4	2026-06-25 09:06:43.265318+00	0	1	healthy
6044	1	2026-06-25 09:09:43.302828+00	0	1	healthy
6045	5	2026-06-25 09:09:43.302828+00	0	1	healthy
6046	2	2026-06-25 09:09:43.302828+00	0	1	healthy
6047	3	2026-06-25 09:09:43.302828+00	0	1	healthy
6048	4	2026-06-25 09:09:43.302828+00	0	1	healthy
6064	1	2026-06-25 09:13:43.26534+00	0	1	healthy
6065	5	2026-06-25 09:13:43.26534+00	0	1	healthy
6066	2	2026-06-25 09:13:43.26534+00	0	1	healthy
6067	3	2026-06-25 09:13:43.26534+00	0	1	healthy
6068	4	2026-06-25 09:13:43.26534+00	0	1	healthy
6079	1	2026-06-25 09:16:43.266528+00	0	1	healthy
6080	5	2026-06-25 09:16:43.266528+00	0	1	healthy
6081	2	2026-06-25 09:16:43.266528+00	0	1	healthy
6082	3	2026-06-25 09:16:43.266528+00	0	1	healthy
6083	4	2026-06-25 09:16:43.266528+00	0	1	healthy
6104	1	2026-06-25 09:21:43.265918+00	0	1	healthy
6105	5	2026-06-25 09:21:43.265918+00	0	1	healthy
6106	2	2026-06-25 09:21:43.265918+00	0	1	healthy
6107	3	2026-06-25 09:21:43.265918+00	0	1	healthy
6108	4	2026-06-25 09:21:43.265918+00	0	1	healthy
6134	1	2026-06-25 09:27:43.267065+00	0	1	healthy
6135	5	2026-06-25 09:27:43.267065+00	0	1	healthy
6136	2	2026-06-25 09:27:43.267065+00	0	1	healthy
6137	3	2026-06-25 09:27:43.267065+00	0	1	healthy
6138	4	2026-06-25 09:27:43.267065+00	0	1	healthy
6164	1	2026-06-25 09:33:43.266927+00	0	1	healthy
6165	5	2026-06-25 09:33:43.266927+00	0	1	healthy
6166	2	2026-06-25 09:33:43.266927+00	0	1	healthy
6167	3	2026-06-25 09:33:43.266927+00	0	1	healthy
6168	4	2026-06-25 09:33:43.266927+00	0	1	healthy
6179	1	2026-06-25 09:36:43.264511+00	0	1	healthy
6180	5	2026-06-25 09:36:43.264511+00	0	1	healthy
6181	2	2026-06-25 09:36:43.264511+00	0	1	healthy
6182	3	2026-06-25 09:36:43.264511+00	0	1	healthy
6183	4	2026-06-25 09:36:43.264511+00	0	1	healthy
6194	1	2026-06-25 09:39:43.321509+00	0	1	healthy
6195	5	2026-06-25 09:39:43.321509+00	0	1	healthy
6196	2	2026-06-25 09:39:43.321509+00	0	1	healthy
6197	3	2026-06-25 09:39:43.321509+00	0	1	healthy
6198	4	2026-06-25 09:39:43.321509+00	0	1	healthy
6219	1	2026-06-25 09:44:43.267449+00	0	1	healthy
6220	5	2026-06-25 09:44:43.267449+00	0	1	healthy
6221	2	2026-06-25 09:44:43.267449+00	0	1	healthy
6222	3	2026-06-25 09:44:43.267449+00	0	1	healthy
6223	4	2026-06-25 09:44:43.267449+00	0	1	healthy
6239	1	2026-06-25 09:48:43.266207+00	0	1	healthy
6240	5	2026-06-25 09:48:43.266207+00	0	1	healthy
6241	2	2026-06-25 09:48:43.266207+00	0	1	healthy
6242	3	2026-06-25 09:48:43.266207+00	0	1	healthy
6243	4	2026-06-25 09:48:43.266207+00	0	1	healthy
6249	1	2026-06-25 09:50:43.265927+00	0	1	healthy
6250	5	2026-06-25 09:50:43.265927+00	0	1	healthy
6251	2	2026-06-25 09:50:43.265927+00	0	1	healthy
6252	3	2026-06-25 09:50:43.265927+00	0	1	healthy
6253	4	2026-06-25 09:50:43.265927+00	0	1	healthy
6284	1	2026-06-25 09:57:43.265654+00	0	1	healthy
6285	5	2026-06-25 09:57:43.265654+00	0	1	healthy
6286	2	2026-06-25 09:57:43.265654+00	0	1	healthy
6287	3	2026-06-25 09:57:43.265654+00	0	1	healthy
6288	4	2026-06-25 09:57:43.265654+00	0	1	healthy
6299	1	2026-06-25 10:00:43.268412+00	0	1	healthy
6300	5	2026-06-25 10:00:43.268412+00	0	1	healthy
6301	2	2026-06-25 10:00:43.268412+00	0	1	healthy
6302	3	2026-06-25 10:00:43.268412+00	0	1	healthy
6303	4	2026-06-25 10:00:43.268412+00	0	1	healthy
6334	1	2026-06-25 10:07:43.26945+00	0	1	healthy
6335	5	2026-06-25 10:07:43.26945+00	0	1	healthy
6336	2	2026-06-25 10:07:43.26945+00	0	1	healthy
6337	3	2026-06-25 10:07:43.26945+00	0	1	healthy
6338	4	2026-06-25 10:07:43.26945+00	0	1	healthy
5839	1	2026-06-25 08:28:43.265546+00	0	1	healthy
5840	5	2026-06-25 08:28:43.265546+00	0	1	healthy
5841	2	2026-06-25 08:28:43.265546+00	0	1	healthy
5842	3	2026-06-25 08:28:43.265546+00	0	1	healthy
5843	4	2026-06-25 08:28:43.265546+00	0	1	healthy
5869	1	2026-06-25 08:34:43.267063+00	0	1	healthy
5870	5	2026-06-25 08:34:43.267063+00	0	1	healthy
5871	2	2026-06-25 08:34:43.267063+00	0	1	healthy
5872	3	2026-06-25 08:34:43.267063+00	0	1	healthy
5873	4	2026-06-25 08:34:43.267063+00	0	1	healthy
5879	1	2026-06-25 08:36:43.266316+00	0	1	healthy
5880	5	2026-06-25 08:36:43.266316+00	0	1	healthy
5881	2	2026-06-25 08:36:43.266316+00	0	1	healthy
5882	3	2026-06-25 08:36:43.266316+00	0	1	healthy
5883	4	2026-06-25 08:36:43.266316+00	0	1	healthy
5884	1	2026-06-25 08:37:43.265417+00	0	1	healthy
5885	5	2026-06-25 08:37:43.265417+00	0	1	healthy
5886	2	2026-06-25 08:37:43.265417+00	0	1	healthy
5887	3	2026-06-25 08:37:43.265417+00	0	1	healthy
5888	4	2026-06-25 08:37:43.265417+00	0	1	healthy
5904	1	2026-06-25 08:41:43.265565+00	0	1	healthy
5905	5	2026-06-25 08:41:43.265565+00	0	1	healthy
5906	2	2026-06-25 08:41:43.265565+00	0	1	healthy
5907	3	2026-06-25 08:41:43.265565+00	0	1	healthy
5908	4	2026-06-25 08:41:43.265565+00	0	1	healthy
5954	1	2026-06-25 08:51:43.26582+00	0	1	healthy
5955	5	2026-06-25 08:51:43.26582+00	0	1	healthy
5956	2	2026-06-25 08:51:43.26582+00	0	1	healthy
5957	3	2026-06-25 08:51:43.26582+00	0	1	healthy
5958	4	2026-06-25 08:51:43.26582+00	0	1	healthy
6004	1	2026-06-25 09:01:43.265386+00	0	1	healthy
6005	5	2026-06-25 09:01:43.265386+00	0	1	healthy
6006	2	2026-06-25 09:01:43.265386+00	0	1	healthy
6007	3	2026-06-25 09:01:43.265386+00	0	1	healthy
6008	4	2026-06-25 09:01:43.265386+00	0	1	healthy
6054	1	2026-06-25 09:11:43.26568+00	0	1	healthy
6055	5	2026-06-25 09:11:43.26568+00	0	1	healthy
6056	2	2026-06-25 09:11:43.26568+00	0	1	healthy
6057	3	2026-06-25 09:11:43.26568+00	0	1	healthy
6058	4	2026-06-25 09:11:43.26568+00	0	1	healthy
6109	1	2026-06-25 09:22:43.2656+00	0	1	healthy
6110	5	2026-06-25 09:22:43.2656+00	0	1	healthy
6111	2	2026-06-25 09:22:43.2656+00	0	1	healthy
6112	3	2026-06-25 09:22:43.2656+00	0	1	healthy
6113	4	2026-06-25 09:22:43.2656+00	0	1	healthy
6159	1	2026-06-25 09:32:43.265278+00	0	1	healthy
6160	5	2026-06-25 09:32:43.265278+00	0	1	healthy
6161	2	2026-06-25 09:32:43.265278+00	0	1	healthy
6162	3	2026-06-25 09:32:43.265278+00	0	1	healthy
6163	4	2026-06-25 09:32:43.265278+00	0	1	healthy
6174	1	2026-06-25 09:35:43.264409+00	0	1	healthy
6175	5	2026-06-25 09:35:43.264409+00	0	1	healthy
6176	2	2026-06-25 09:35:43.264409+00	0	1	healthy
6177	3	2026-06-25 09:35:43.264409+00	0	1	healthy
6178	4	2026-06-25 09:35:43.264409+00	0	1	healthy
6199	1	2026-06-25 09:40:43.265865+00	0	1	healthy
6200	5	2026-06-25 09:40:43.265865+00	0	1	healthy
6201	2	2026-06-25 09:40:43.265865+00	0	1	healthy
6202	3	2026-06-25 09:40:43.265865+00	0	1	healthy
6203	4	2026-06-25 09:40:43.265865+00	0	1	healthy
6234	1	2026-06-25 09:47:43.265548+00	0	1	healthy
6235	5	2026-06-25 09:47:43.265548+00	0	1	healthy
6236	2	2026-06-25 09:47:43.265548+00	0	1	healthy
6237	3	2026-06-25 09:47:43.265548+00	0	1	healthy
6238	4	2026-06-25 09:47:43.265548+00	0	1	healthy
6269	1	2026-06-25 09:54:43.266889+00	0	1	healthy
6270	5	2026-06-25 09:54:43.266889+00	0	1	healthy
6271	2	2026-06-25 09:54:43.266889+00	0	1	healthy
6272	3	2026-06-25 09:54:43.266889+00	0	1	healthy
6273	4	2026-06-25 09:54:43.266889+00	0	1	healthy
6289	1	2026-06-25 09:58:43.266367+00	0	1	healthy
6290	5	2026-06-25 09:58:43.266367+00	0	1	healthy
6291	2	2026-06-25 09:58:43.266367+00	0	1	healthy
6292	3	2026-06-25 09:58:43.266367+00	0	1	healthy
6293	4	2026-06-25 09:58:43.266367+00	0	1	healthy
6304	1	2026-06-25 10:01:43.265838+00	0	1	healthy
6305	5	2026-06-25 10:01:43.265838+00	0	1	healthy
6306	2	2026-06-25 10:01:43.265838+00	0	1	healthy
6307	3	2026-06-25 10:01:43.265838+00	0	1	healthy
6308	4	2026-06-25 10:01:43.265838+00	0	1	healthy
7434	1	2026-06-26 04:31:43.828559+00	0	1	healthy
7435	5	2026-06-26 04:31:43.828559+00	0	1	healthy
7436	2	2026-06-26 04:31:43.828559+00	0	1	healthy
7437	3	2026-06-26 04:31:43.828559+00	0	1	healthy
7438	4	2026-06-26 04:31:43.828559+00	0	1	healthy
7439	1	2026-06-26 04:46:43.883233+00	0	1	healthy
7440	5	2026-06-26 04:46:43.883233+00	0	1	healthy
7441	2	2026-06-26 04:46:43.883233+00	0	1	healthy
7442	3	2026-06-26 04:46:43.883233+00	0	1	healthy
7443	4	2026-06-26 04:46:43.883233+00	0	1	healthy
5844	1	2026-06-25 08:29:43.266186+00	0	1	healthy
5845	5	2026-06-25 08:29:43.266186+00	0	1	healthy
5846	2	2026-06-25 08:29:43.266186+00	0	1	healthy
5847	3	2026-06-25 08:29:43.266186+00	0	1	healthy
5848	4	2026-06-25 08:29:43.266186+00	0	1	healthy
5859	1	2026-06-25 08:32:43.265339+00	0	1	healthy
5860	5	2026-06-25 08:32:43.265339+00	0	1	healthy
5861	2	2026-06-25 08:32:43.265339+00	0	1	healthy
5862	3	2026-06-25 08:32:43.265339+00	0	1	healthy
5863	4	2026-06-25 08:32:43.265339+00	0	1	healthy
5874	1	2026-06-25 08:35:43.266342+00	0	1	healthy
5875	5	2026-06-25 08:35:43.266342+00	0	1	healthy
5876	2	2026-06-25 08:35:43.266342+00	0	1	healthy
5877	3	2026-06-25 08:35:43.266342+00	0	1	healthy
5878	4	2026-06-25 08:35:43.266342+00	0	1	healthy
5909	1	2026-06-25 08:42:43.264445+00	0	1	healthy
5910	5	2026-06-25 08:42:43.264445+00	0	1	healthy
5911	2	2026-06-25 08:42:43.264445+00	0	1	healthy
5912	3	2026-06-25 08:42:43.264445+00	0	1	healthy
5913	4	2026-06-25 08:42:43.264445+00	0	1	healthy
5924	1	2026-06-25 08:45:43.265177+00	0	1	healthy
5925	5	2026-06-25 08:45:43.265177+00	0	1	healthy
5926	2	2026-06-25 08:45:43.265177+00	0	1	healthy
5927	3	2026-06-25 08:45:43.265177+00	0	1	healthy
5928	4	2026-06-25 08:45:43.265177+00	0	1	healthy
5944	1	2026-06-25 08:49:43.265744+00	0	1	healthy
5945	5	2026-06-25 08:49:43.265744+00	0	1	healthy
5946	2	2026-06-25 08:49:43.265744+00	0	1	healthy
5947	3	2026-06-25 08:49:43.265744+00	0	1	healthy
5948	4	2026-06-25 08:49:43.265744+00	0	1	healthy
5964	1	2026-06-25 08:53:43.265816+00	0	1	healthy
5965	5	2026-06-25 08:53:43.265816+00	0	1	healthy
5966	2	2026-06-25 08:53:43.265816+00	0	1	healthy
5967	3	2026-06-25 08:53:43.265816+00	0	1	healthy
5968	4	2026-06-25 08:53:43.265816+00	0	1	healthy
5979	1	2026-06-25 08:56:43.264899+00	0	1	healthy
5980	5	2026-06-25 08:56:43.264899+00	0	1	healthy
5981	2	2026-06-25 08:56:43.264899+00	0	1	healthy
5982	3	2026-06-25 08:56:43.264899+00	0	1	healthy
5983	4	2026-06-25 08:56:43.264899+00	0	1	healthy
6009	1	2026-06-25 09:02:43.265556+00	0	1	healthy
6010	5	2026-06-25 09:02:43.265556+00	0	1	healthy
6011	2	2026-06-25 09:02:43.265556+00	0	1	healthy
6012	3	2026-06-25 09:02:43.265556+00	0	1	healthy
6013	4	2026-06-25 09:02:43.265556+00	0	1	healthy
6024	1	2026-06-25 09:05:43.266337+00	0	1	healthy
6025	5	2026-06-25 09:05:43.266337+00	0	1	healthy
6026	2	2026-06-25 09:05:43.266337+00	0	1	healthy
6027	3	2026-06-25 09:05:43.266337+00	0	1	healthy
6028	4	2026-06-25 09:05:43.266337+00	0	1	healthy
6059	1	2026-06-25 09:12:43.266408+00	0	1	healthy
6060	5	2026-06-25 09:12:43.266408+00	0	1	healthy
6061	2	2026-06-25 09:12:43.266408+00	0	1	healthy
6062	3	2026-06-25 09:12:43.266408+00	0	1	healthy
6063	4	2026-06-25 09:12:43.266408+00	0	1	healthy
6074	1	2026-06-25 09:15:43.264915+00	0	1	healthy
6075	5	2026-06-25 09:15:43.264915+00	0	1	healthy
6076	2	2026-06-25 09:15:43.264915+00	0	1	healthy
6077	3	2026-06-25 09:15:43.264915+00	0	1	healthy
6078	4	2026-06-25 09:15:43.264915+00	0	1	healthy
6094	1	2026-06-25 09:19:43.267241+00	0	1	healthy
6095	5	2026-06-25 09:19:43.267241+00	0	1	healthy
6096	2	2026-06-25 09:19:43.267241+00	0	1	healthy
6097	3	2026-06-25 09:19:43.267241+00	0	1	healthy
6098	4	2026-06-25 09:19:43.267241+00	0	1	healthy
6124	1	2026-06-25 09:25:43.265543+00	0	1	healthy
6125	5	2026-06-25 09:25:43.265543+00	0	1	healthy
6126	2	2026-06-25 09:25:43.265543+00	0	1	healthy
6127	3	2026-06-25 09:25:43.265543+00	0	1	healthy
6128	4	2026-06-25 09:25:43.265543+00	0	1	healthy
6144	1	2026-06-25 09:29:43.266958+00	0	1	healthy
6145	5	2026-06-25 09:29:43.266958+00	0	1	healthy
6146	2	2026-06-25 09:29:43.266958+00	0	1	healthy
6147	3	2026-06-25 09:29:43.266958+00	0	1	healthy
6148	4	2026-06-25 09:29:43.266958+00	0	1	healthy
6169	1	2026-06-25 09:34:43.270602+00	0	1	healthy
6170	5	2026-06-25 09:34:43.270602+00	0	1	healthy
6171	2	2026-06-25 09:34:43.270602+00	0	1	healthy
6172	3	2026-06-25 09:34:43.270602+00	0	1	healthy
6173	4	2026-06-25 09:34:43.270602+00	0	1	healthy
6204	1	2026-06-25 09:41:43.265459+00	0	1	healthy
6205	5	2026-06-25 09:41:43.265459+00	0	1	healthy
6206	2	2026-06-25 09:41:43.265459+00	0	1	healthy
6207	3	2026-06-25 09:41:43.265459+00	0	1	healthy
6208	4	2026-06-25 09:41:43.265459+00	0	1	healthy
6254	1	2026-06-25 09:51:43.265963+00	0	1	healthy
6255	5	2026-06-25 09:51:43.265963+00	0	1	healthy
6256	2	2026-06-25 09:51:43.265963+00	0	1	healthy
6257	3	2026-06-25 09:51:43.265963+00	0	1	healthy
6258	4	2026-06-25 09:51:43.265963+00	0	1	healthy
6319	1	2026-06-25 10:04:43.366497+00	0	1	healthy
6320	5	2026-06-25 10:04:43.366497+00	0	1	healthy
6321	2	2026-06-25 10:04:43.366497+00	0	1	healthy
6322	3	2026-06-25 10:04:43.366497+00	0	1	healthy
6323	4	2026-06-25 10:04:43.366497+00	0	1	healthy
6339	1	2026-06-25 10:08:43.265937+00	0	1	healthy
6340	5	2026-06-25 10:08:43.265937+00	0	1	healthy
6341	2	2026-06-25 10:08:43.265937+00	0	1	healthy
6342	3	2026-06-25 10:08:43.265937+00	0	1	healthy
6343	4	2026-06-25 10:08:43.265937+00	0	1	healthy
6359	1	2026-06-25 10:12:43.264795+00	0	1	healthy
6360	5	2026-06-25 10:12:43.264795+00	0	1	healthy
6361	2	2026-06-25 10:12:43.264795+00	0	1	healthy
6362	3	2026-06-25 10:12:43.264795+00	0	1	healthy
6363	4	2026-06-25 10:12:43.264795+00	0	1	healthy
7444	1	2026-06-26 05:01:43.833583+00	0	1	healthy
7445	5	2026-06-26 05:01:43.833583+00	0	1	healthy
7446	2	2026-06-26 05:01:43.833583+00	0	1	healthy
7447	3	2026-06-26 05:01:43.833583+00	0	1	healthy
7448	4	2026-06-26 05:01:43.833583+00	0	1	healthy
5854	1	2026-06-25 08:31:43.264874+00	0	1	healthy
5855	5	2026-06-25 08:31:43.264874+00	0	1	healthy
5856	2	2026-06-25 08:31:43.264874+00	0	1	healthy
5857	3	2026-06-25 08:31:43.264874+00	0	1	healthy
5858	4	2026-06-25 08:31:43.264874+00	0	1	healthy
5864	1	2026-06-25 08:33:43.265316+00	0	1	healthy
5865	5	2026-06-25 08:33:43.265316+00	0	1	healthy
5866	2	2026-06-25 08:33:43.265316+00	0	1	healthy
5867	3	2026-06-25 08:33:43.265316+00	0	1	healthy
5868	4	2026-06-25 08:33:43.265316+00	0	1	healthy
5889	1	2026-06-25 08:38:43.274823+00	0	1	healthy
5890	5	2026-06-25 08:38:43.274823+00	0	1	healthy
5891	2	2026-06-25 08:38:43.274823+00	0	1	healthy
5892	3	2026-06-25 08:38:43.274823+00	0	1	healthy
5893	4	2026-06-25 08:38:43.274823+00	0	1	healthy
5899	1	2026-06-25 08:40:43.265388+00	0	1	healthy
5900	5	2026-06-25 08:40:43.265388+00	0	1	healthy
5901	2	2026-06-25 08:40:43.265388+00	0	1	healthy
5902	3	2026-06-25 08:40:43.265388+00	0	1	healthy
5903	4	2026-06-25 08:40:43.265388+00	0	1	healthy
5919	1	2026-06-25 08:44:43.267459+00	0	1	healthy
5920	5	2026-06-25 08:44:43.267459+00	0	1	healthy
5921	2	2026-06-25 08:44:43.267459+00	0	1	healthy
5922	3	2026-06-25 08:44:43.267459+00	0	1	healthy
5923	4	2026-06-25 08:44:43.267459+00	0	1	healthy
5934	1	2026-06-25 08:47:43.264344+00	0	1	healthy
5935	5	2026-06-25 08:47:43.264344+00	0	1	healthy
5936	2	2026-06-25 08:47:43.264344+00	0	1	healthy
5937	3	2026-06-25 08:47:43.264344+00	0	1	healthy
5938	4	2026-06-25 08:47:43.264344+00	0	1	healthy
5939	1	2026-06-25 08:48:43.266389+00	0	1	healthy
5940	5	2026-06-25 08:48:43.266389+00	0	1	healthy
5941	2	2026-06-25 08:48:43.266389+00	0	1	healthy
5942	3	2026-06-25 08:48:43.266389+00	0	1	healthy
5943	4	2026-06-25 08:48:43.266389+00	0	1	healthy
5949	1	2026-06-25 08:50:43.265863+00	0	1	healthy
5950	5	2026-06-25 08:50:43.265863+00	0	1	healthy
5951	2	2026-06-25 08:50:43.265863+00	0	1	healthy
5952	3	2026-06-25 08:50:43.265863+00	0	1	healthy
5953	4	2026-06-25 08:50:43.265863+00	0	1	healthy
5969	1	2026-06-25 08:54:43.422244+00	0	1	healthy
5970	5	2026-06-25 08:54:43.422244+00	0	1	healthy
5971	2	2026-06-25 08:54:43.422244+00	0	1	healthy
5972	3	2026-06-25 08:54:43.422244+00	0	1	healthy
5973	4	2026-06-25 08:54:43.422244+00	0	1	healthy
5984	1	2026-06-25 08:57:43.265747+00	0	1	healthy
5985	5	2026-06-25 08:57:43.265747+00	0	1	healthy
5986	2	2026-06-25 08:57:43.265747+00	0	1	healthy
5987	3	2026-06-25 08:57:43.265747+00	0	1	healthy
5988	4	2026-06-25 08:57:43.265747+00	0	1	healthy
5989	1	2026-06-25 08:58:43.267223+00	0	1	healthy
5990	5	2026-06-25 08:58:43.267223+00	0	1	healthy
5991	2	2026-06-25 08:58:43.267223+00	0	1	healthy
5992	3	2026-06-25 08:58:43.267223+00	0	1	healthy
5993	4	2026-06-25 08:58:43.267223+00	0	1	healthy
5999	1	2026-06-25 09:00:43.264946+00	0	1	healthy
6000	5	2026-06-25 09:00:43.264946+00	0	1	healthy
6001	2	2026-06-25 09:00:43.264946+00	0	1	healthy
6002	3	2026-06-25 09:00:43.264946+00	0	1	healthy
6003	4	2026-06-25 09:00:43.264946+00	0	1	healthy
6019	1	2026-06-25 09:04:43.264728+00	0	1	healthy
6020	5	2026-06-25 09:04:43.264728+00	0	1	healthy
6021	2	2026-06-25 09:04:43.264728+00	0	1	healthy
6022	3	2026-06-25 09:04:43.264728+00	0	1	healthy
6023	4	2026-06-25 09:04:43.264728+00	0	1	healthy
6034	1	2026-06-25 09:07:43.264608+00	0	1	healthy
6035	5	2026-06-25 09:07:43.264608+00	0	1	healthy
6036	2	2026-06-25 09:07:43.264608+00	0	1	healthy
6037	3	2026-06-25 09:07:43.264608+00	0	1	healthy
6038	4	2026-06-25 09:07:43.264608+00	0	1	healthy
6039	1	2026-06-25 09:08:43.266083+00	0	1	healthy
6040	5	2026-06-25 09:08:43.266083+00	0	1	healthy
6041	2	2026-06-25 09:08:43.266083+00	0	1	healthy
6042	3	2026-06-25 09:08:43.266083+00	0	1	healthy
6043	4	2026-06-25 09:08:43.266083+00	0	1	healthy
6049	1	2026-06-25 09:10:43.273196+00	0	1	healthy
6050	5	2026-06-25 09:10:43.273196+00	0	1	healthy
6051	2	2026-06-25 09:10:43.273196+00	0	1	healthy
6052	3	2026-06-25 09:10:43.273196+00	0	1	healthy
6053	4	2026-06-25 09:10:43.273196+00	0	1	healthy
6069	1	2026-06-25 09:14:43.266836+00	0	1	healthy
6070	5	2026-06-25 09:14:43.266836+00	0	1	healthy
6071	2	2026-06-25 09:14:43.266836+00	0	1	healthy
6072	3	2026-06-25 09:14:43.266836+00	0	1	healthy
6073	4	2026-06-25 09:14:43.266836+00	0	1	healthy
6084	1	2026-06-25 09:17:43.264989+00	0	1	healthy
6085	5	2026-06-25 09:17:43.264989+00	0	1	healthy
6086	2	2026-06-25 09:17:43.264989+00	0	1	healthy
6087	3	2026-06-25 09:17:43.264989+00	0	1	healthy
6088	4	2026-06-25 09:17:43.264989+00	0	1	healthy
6089	1	2026-06-25 09:18:43.266894+00	0	1	healthy
6090	5	2026-06-25 09:18:43.266894+00	0	1	healthy
6091	2	2026-06-25 09:18:43.266894+00	0	1	healthy
6092	3	2026-06-25 09:18:43.266894+00	0	1	healthy
6093	4	2026-06-25 09:18:43.266894+00	0	1	healthy
6099	1	2026-06-25 09:20:43.265935+00	0	1	healthy
6100	5	2026-06-25 09:20:43.265935+00	0	1	healthy
6101	2	2026-06-25 09:20:43.265935+00	0	1	healthy
6102	3	2026-06-25 09:20:43.265935+00	0	1	healthy
6103	4	2026-06-25 09:20:43.265935+00	0	1	healthy
6114	1	2026-06-25 09:23:43.265331+00	0	1	healthy
6115	5	2026-06-25 09:23:43.265331+00	0	1	healthy
6116	2	2026-06-25 09:23:43.265331+00	0	1	healthy
6117	3	2026-06-25 09:23:43.265331+00	0	1	healthy
6118	4	2026-06-25 09:23:43.265331+00	0	1	healthy
6119	1	2026-06-25 09:24:43.323667+00	0	1	healthy
6120	5	2026-06-25 09:24:43.323667+00	0	1	healthy
6121	2	2026-06-25 09:24:43.323667+00	0	1	healthy
6122	3	2026-06-25 09:24:43.323667+00	0	1	healthy
6123	4	2026-06-25 09:24:43.323667+00	0	1	healthy
6129	1	2026-06-25 09:26:43.266048+00	0	1	healthy
6130	5	2026-06-25 09:26:43.266048+00	0	1	healthy
6131	2	2026-06-25 09:26:43.266048+00	0	1	healthy
6132	3	2026-06-25 09:26:43.266048+00	0	1	healthy
6133	4	2026-06-25 09:26:43.266048+00	0	1	healthy
6139	1	2026-06-25 09:28:43.268754+00	0	1	healthy
6140	5	2026-06-25 09:28:43.268754+00	0	1	healthy
6141	2	2026-06-25 09:28:43.268754+00	0	1	healthy
6142	3	2026-06-25 09:28:43.268754+00	0	1	healthy
6143	4	2026-06-25 09:28:43.268754+00	0	1	healthy
6149	1	2026-06-25 09:30:43.266486+00	0	1	healthy
6150	5	2026-06-25 09:30:43.266486+00	0	1	healthy
6151	2	2026-06-25 09:30:43.266486+00	0	1	healthy
6152	3	2026-06-25 09:30:43.266486+00	0	1	healthy
6153	4	2026-06-25 09:30:43.266486+00	0	1	healthy
6184	1	2026-06-25 09:37:43.267644+00	0	1	healthy
6185	5	2026-06-25 09:37:43.267644+00	0	1	healthy
6186	2	2026-06-25 09:37:43.267644+00	0	1	healthy
6187	3	2026-06-25 09:37:43.267644+00	0	1	healthy
6188	4	2026-06-25 09:37:43.267644+00	0	1	healthy
6209	1	2026-06-25 09:42:43.26545+00	0	1	healthy
6210	5	2026-06-25 09:42:43.26545+00	0	1	healthy
6211	2	2026-06-25 09:42:43.26545+00	0	1	healthy
6212	3	2026-06-25 09:42:43.26545+00	0	1	healthy
6213	4	2026-06-25 09:42:43.26545+00	0	1	healthy
6224	1	2026-06-25 09:45:43.265676+00	0	1	healthy
6225	5	2026-06-25 09:45:43.265676+00	0	1	healthy
6226	2	2026-06-25 09:45:43.265676+00	0	1	healthy
6227	3	2026-06-25 09:45:43.265676+00	0	1	healthy
6228	4	2026-06-25 09:45:43.265676+00	0	1	healthy
6244	1	2026-06-25 09:49:43.267676+00	0	1	healthy
6245	5	2026-06-25 09:49:43.267676+00	0	1	healthy
6246	2	2026-06-25 09:49:43.267676+00	0	1	healthy
6247	3	2026-06-25 09:49:43.267676+00	0	1	healthy
6248	4	2026-06-25 09:49:43.267676+00	0	1	healthy
6264	1	2026-06-25 09:53:43.266009+00	0	1	healthy
6265	5	2026-06-25 09:53:43.266009+00	0	1	healthy
6266	2	2026-06-25 09:53:43.266009+00	0	1	healthy
6267	3	2026-06-25 09:53:43.266009+00	0	1	healthy
6268	4	2026-06-25 09:53:43.266009+00	0	1	healthy
6279	1	2026-06-25 09:56:43.267452+00	0	1	healthy
6280	5	2026-06-25 09:56:43.267452+00	0	1	healthy
6281	2	2026-06-25 09:56:43.267452+00	0	1	healthy
6282	3	2026-06-25 09:56:43.267452+00	0	1	healthy
6283	4	2026-06-25 09:56:43.267452+00	0	1	healthy
6314	1	2026-06-25 10:03:43.265356+00	0	1	healthy
6315	5	2026-06-25 10:03:43.265356+00	0	1	healthy
6316	2	2026-06-25 10:03:43.265356+00	0	1	healthy
6317	3	2026-06-25 10:03:43.265356+00	0	1	healthy
6318	4	2026-06-25 10:03:43.265356+00	0	1	healthy
6329	1	2026-06-25 10:06:43.26562+00	0	1	healthy
6330	5	2026-06-25 10:06:43.26562+00	0	1	healthy
6331	2	2026-06-25 10:06:43.26562+00	0	1	healthy
6332	3	2026-06-25 10:06:43.26562+00	0	1	healthy
6333	4	2026-06-25 10:06:43.26562+00	0	1	healthy
6344	1	2026-06-25 10:09:43.26663+00	0	1	healthy
6345	5	2026-06-25 10:09:43.26663+00	0	1	healthy
6346	2	2026-06-25 10:09:43.26663+00	0	1	healthy
6347	3	2026-06-25 10:09:43.26663+00	0	1	healthy
6348	4	2026-06-25 10:09:43.26663+00	0	1	healthy
6354	1	2026-06-25 10:11:43.26556+00	0	1	healthy
6355	5	2026-06-25 10:11:43.26556+00	0	1	healthy
6356	2	2026-06-25 10:11:43.26556+00	0	1	healthy
6357	3	2026-06-25 10:11:43.26556+00	0	1	healthy
6358	4	2026-06-25 10:11:43.26556+00	0	1	healthy
7459	1	2026-06-26 07:01:43.844575+00	0	1	healthy
7460	5	2026-06-26 07:01:43.844575+00	0	1	healthy
7461	2	2026-06-26 07:01:43.844575+00	0	1	healthy
7462	3	2026-06-26 07:01:43.844575+00	0	1	healthy
7463	4	2026-06-26 07:01:43.844575+00	0	1	healthy
6154	1	2026-06-25 09:31:43.265106+00	0	1	healthy
6155	5	2026-06-25 09:31:43.265106+00	0	1	healthy
6156	2	2026-06-25 09:31:43.265106+00	0	1	healthy
6157	3	2026-06-25 09:31:43.265106+00	0	1	healthy
6158	4	2026-06-25 09:31:43.265106+00	0	1	healthy
6189	1	2026-06-25 09:38:43.265563+00	0	1	healthy
6190	5	2026-06-25 09:38:43.265563+00	0	1	healthy
6191	2	2026-06-25 09:38:43.265563+00	0	1	healthy
6192	3	2026-06-25 09:38:43.265563+00	0	1	healthy
6193	4	2026-06-25 09:38:43.265563+00	0	1	healthy
6214	1	2026-06-25 09:43:43.265605+00	0	1	healthy
6215	5	2026-06-25 09:43:43.265605+00	0	1	healthy
6216	2	2026-06-25 09:43:43.265605+00	0	1	healthy
6217	3	2026-06-25 09:43:43.265605+00	0	1	healthy
6218	4	2026-06-25 09:43:43.265605+00	0	1	healthy
6229	1	2026-06-25 09:46:43.267325+00	0	1	healthy
6230	5	2026-06-25 09:46:43.267325+00	0	1	healthy
6231	2	2026-06-25 09:46:43.267325+00	0	1	healthy
6232	3	2026-06-25 09:46:43.267325+00	0	1	healthy
6233	4	2026-06-25 09:46:43.267325+00	0	1	healthy
6259	1	2026-06-25 09:52:43.28748+00	0	1	healthy
6260	5	2026-06-25 09:52:43.28748+00	0	1	healthy
6261	2	2026-06-25 09:52:43.28748+00	0	1	healthy
6262	3	2026-06-25 09:52:43.28748+00	0	1	healthy
6263	4	2026-06-25 09:52:43.28748+00	0	1	healthy
6274	1	2026-06-25 09:55:43.307001+00	0	1	healthy
6275	5	2026-06-25 09:55:43.307001+00	0	1	healthy
6276	2	2026-06-25 09:55:43.307001+00	0	1	healthy
6277	3	2026-06-25 09:55:43.307001+00	0	1	healthy
6278	4	2026-06-25 09:55:43.307001+00	0	1	healthy
6294	1	2026-06-25 09:59:43.266255+00	0	1	healthy
6295	5	2026-06-25 09:59:43.266255+00	0	1	healthy
6296	2	2026-06-25 09:59:43.266255+00	0	1	healthy
6297	3	2026-06-25 09:59:43.266255+00	0	1	healthy
6298	4	2026-06-25 09:59:43.266255+00	0	1	healthy
6309	1	2026-06-25 10:02:43.265769+00	0	1	healthy
6310	5	2026-06-25 10:02:43.265769+00	0	1	healthy
6311	2	2026-06-25 10:02:43.265769+00	0	1	healthy
6312	3	2026-06-25 10:02:43.265769+00	0	1	healthy
6313	4	2026-06-25 10:02:43.265769+00	0	1	healthy
6324	1	2026-06-25 10:05:43.266801+00	0	1	healthy
6325	5	2026-06-25 10:05:43.266801+00	0	1	healthy
6326	2	2026-06-25 10:05:43.266801+00	0	1	healthy
6327	3	2026-06-25 10:05:43.266801+00	0	1	healthy
6328	4	2026-06-25 10:05:43.266801+00	0	1	healthy
7464	1	2026-06-26 07:16:43.880177+00	0	1	healthy
7465	5	2026-06-26 07:16:43.880177+00	0	1	healthy
7466	2	2026-06-26 07:16:43.880177+00	0	1	healthy
7467	3	2026-06-26 07:16:43.880177+00	0	1	healthy
7468	4	2026-06-26 07:16:43.880177+00	0	1	healthy
6349	1	2026-06-25 10:10:43.266189+00	0	1	healthy
6350	5	2026-06-25 10:10:43.266189+00	0	1	healthy
6351	2	2026-06-25 10:10:43.266189+00	0	1	healthy
6352	3	2026-06-25 10:10:43.266189+00	0	1	healthy
6353	4	2026-06-25 10:10:43.266189+00	0	1	healthy
7469	1	2026-06-26 07:31:43.908219+00	0	1	healthy
7470	5	2026-06-26 07:31:43.908219+00	0	1	healthy
7471	2	2026-06-26 07:31:43.908219+00	0	1	healthy
7472	3	2026-06-26 07:31:43.908219+00	0	1	healthy
7473	4	2026-06-26 07:31:43.908219+00	0	1	healthy
7484	1	2026-06-26 08:16:43.941199+00	0	1	healthy
7485	5	2026-06-26 08:16:43.941199+00	0	1	healthy
7486	2	2026-06-26 08:16:43.941199+00	0	1	healthy
7487	3	2026-06-26 08:16:43.941199+00	0	1	healthy
7488	4	2026-06-26 08:16:43.941199+00	0	1	healthy
\.


--
-- Data for Name: providers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.providers (id, name, type, config, priority, is_active, quality_score, adapter_type, pricing_strategy, fallback_provider_id) FROM stdin;
1	Mock Provider	mock	{}	10	t	100	mock	fixed	\N
5	Proxora Team	manual	{"channel": "#takedown"}	10	t	100	manual	task	\N
2	Seller Pool	seller_pool	{}	10	t	100	seller_pool	fixed	1
3	TopProxy (mock)	proxy	{"api_key": "tp_demo_key"}	10	t	100	mock	config	1
4	ScrapCreators (mock)	endpoint	{"api_key": "sc_demo_key"}	10	t	100	mock	credit	1
\.


--
-- Data for Name: resources; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.resources (id, variant_id, seller_id, status, data, created_at, expires_at, order_id, assigned_at, provider_id) FROM stdin;
6	2	2	available	tw2fa2|pass|2fa_key|mail@ex.com	2026-06-22 02:34:10.421866+00	\N	\N	\N	\N
8	4	2	available	fb2|pass|2fa_key|mail2@hotmail.com|cookie2	2026-06-22 02:34:10.648881+00	\N	\N	\N	\N
9	4	2	available	fb3|pass|2fa_key|mail3@hotmail.com|cookie3	2026-06-22 02:34:10.648881+00	\N	\N	\N	\N
11	5	2	available	fb5|pass|mail@svmail.com|cookie	2026-06-22 02:34:10.708515+00	\N	\N	\N	\N
15	8	2	available	tg4|+84xxx|session_data4	2026-06-22 02:34:10.992808+00	\N	\N	\N	\N
16	8	2	available	tg5|+84xxx|session_data5	2026-06-22 02:34:10.992808+00	\N	\N	\N	\N
18	18	2	available	visa_10usd_001|4242****|12/27|123	2026-06-22 02:34:11.872051+00	\N	\N	\N	\N
19	18	2	available	visa_10usd_002|4242****|12/27|456	2026-06-22 02:34:11.872051+00	\N	\N	\N	\N
20	19	2	available	visa_50usd_001|4242****|12/27|789	2026-06-22 02:34:11.945196+00	\N	\N	\N	\N
12	8	2	assigned	tg1|+84xxx|session_data1	2026-06-22 02:34:10.992808+00	\N	1	2026-06-22 02:35:24.180278+00	\N
17	9	2	assigned	tga1|+1xxx|session_old1	2026-06-22 02:34:11.046185+00	\N	2	2026-06-22 02:36:37.096811+00	\N
5	2	2	assigned	tw2fa1|pass|2fa_key|mail@ex.com	2026-06-22 02:34:10.421866+00	\N	5	2026-06-22 02:48:11.582586+00	\N
1	1	2	assigned	tw1|pass1|mail1@ex.com|cookie1	2026-06-22 02:34:10.232833+00	\N	6	2026-06-22 02:48:52.231231+00	\N
2	1	2	assigned	tw2|pass2|mail2@ex.com|cookie2	2026-06-22 02:34:10.232833+00	\N	7	2026-06-22 02:53:23.250218+00	\N
3	1	2	assigned	tw3|pass3|mail3@ex.com|cookie3	2026-06-22 02:34:10.232833+00	\N	8	2026-06-22 02:53:29.324339+00	\N
4	1	2	assigned	tw4|pass4|mail4@ex.com|cookie4	2026-06-22 02:34:10.232833+00	\N	10	2026-06-22 04:03:50.046269+00	\N
13	8	2	assigned	tg2|+84xxx|session_data2	2026-06-22 02:34:10.992808+00	\N	11	2026-06-22 05:49:56.311582+00	\N
22	21	2	available	tw2|pass2|mail2@ex.com|cookie2	2026-06-23 07:07:18.408181+00	\N	\N	\N	\N
23	21	2	available	tw3|pass3|mail3@ex.com|cookie3	2026-06-23 07:07:18.408181+00	\N	\N	\N	\N
24	21	2	available	tw4|pass4|mail4@ex.com|cookie4	2026-06-23 07:07:18.408181+00	\N	\N	\N	\N
25	22	2	available	tw2fa1|pass|2fa_key|mail@ex.com	2026-06-23 07:07:18.447623+00	\N	\N	\N	\N
26	22	2	available	tw2fa2|pass|2fa_key|mail@ex.com	2026-06-23 07:07:18.447623+00	\N	\N	\N	\N
27	24	2	available	fb1|pass|2fa_key|mail1@hotmail.com|cookie1	2026-06-23 07:07:18.594634+00	\N	\N	\N	\N
28	24	2	available	fb2|pass|2fa_key|mail2@hotmail.com|cookie2	2026-06-23 07:07:18.594634+00	\N	\N	\N	\N
29	24	2	available	fb3|pass|2fa_key|mail3@hotmail.com|cookie3	2026-06-23 07:07:18.594634+00	\N	\N	\N	\N
31	25	2	available	fb5|pass|mail@svmail.com|cookie	2026-06-23 07:07:18.623153+00	\N	\N	\N	\N
32	28	2	available	tg1|+84xxx|session_data1	2026-06-23 07:07:18.783934+00	\N	\N	\N	\N
33	28	2	available	tg2|+84xxx|session_data2	2026-06-23 07:07:18.783934+00	\N	\N	\N	\N
34	28	2	available	tg3|+84xxx|session_data3	2026-06-23 07:07:18.783934+00	\N	\N	\N	\N
35	28	2	available	tg4|+84xxx|session_data4	2026-06-23 07:07:18.783934+00	\N	\N	\N	\N
36	28	2	available	tg5|+84xxx|session_data5	2026-06-23 07:07:18.783934+00	\N	\N	\N	\N
37	29	2	available	tga1|+1xxx|session_old1	2026-06-23 07:07:18.809755+00	\N	\N	\N	\N
38	31	2	available	visa_10usd_001|4242****|12/27|123	2026-06-23 07:07:18.982205+00	\N	\N	\N	\N
39	31	2	available	visa_10usd_002|4242****|12/27|456	2026-06-23 07:07:18.982205+00	\N	\N	\N	\N
40	32	2	available	visa_50usd_001|4242****|12/27|789	2026-06-23 07:07:19.044793+00	\N	\N	\N	\N
41	34	2	available	tw1|pass1|mail1@ex.com|cookie1	2026-06-23 07:08:03.73123+00	\N	\N	\N	\N
42	34	2	available	tw2|pass2|mail2@ex.com|cookie2	2026-06-23 07:08:03.73123+00	\N	\N	\N	\N
43	34	2	available	tw3|pass3|mail3@ex.com|cookie3	2026-06-23 07:08:03.73123+00	\N	\N	\N	\N
44	34	2	available	tw4|pass4|mail4@ex.com|cookie4	2026-06-23 07:08:03.73123+00	\N	\N	\N	\N
45	35	2	available	tw2fa1|pass|2fa_key|mail@ex.com	2026-06-23 07:08:03.748013+00	\N	\N	\N	\N
46	35	2	available	tw2fa2|pass|2fa_key|mail@ex.com	2026-06-23 07:08:03.748013+00	\N	\N	\N	\N
47	37	2	available	fb1|pass|2fa_key|mail1@hotmail.com|cookie1	2026-06-23 07:08:03.832801+00	\N	\N	\N	\N
48	37	2	available	fb2|pass|2fa_key|mail2@hotmail.com|cookie2	2026-06-23 07:08:03.832801+00	\N	\N	\N	\N
49	37	2	available	fb3|pass|2fa_key|mail3@hotmail.com|cookie3	2026-06-23 07:08:03.832801+00	\N	\N	\N	\N
50	38	2	available	fb4|pass|mail@svmail.com|cookie	2026-06-23 07:08:03.850996+00	\N	\N	\N	\N
51	38	2	available	fb5|pass|mail@svmail.com|cookie	2026-06-23 07:08:03.850996+00	\N	\N	\N	\N
52	41	2	available	tg1|+84xxx|session_data1	2026-06-23 07:08:03.944841+00	\N	\N	\N	\N
53	41	2	available	tg2|+84xxx|session_data2	2026-06-23 07:08:03.944841+00	\N	\N	\N	\N
54	41	2	available	tg3|+84xxx|session_data3	2026-06-23 07:08:03.944841+00	\N	\N	\N	\N
55	41	2	available	tg4|+84xxx|session_data4	2026-06-23 07:08:03.944841+00	\N	\N	\N	\N
56	41	2	available	tg5|+84xxx|session_data5	2026-06-23 07:08:03.944841+00	\N	\N	\N	\N
57	42	2	available	tga1|+1xxx|session_old1	2026-06-23 07:08:03.964099+00	\N	\N	\N	\N
58	44	2	available	visa_10usd_001|4242****|12/27|123	2026-06-23 07:08:04.044965+00	\N	\N	\N	\N
59	44	2	available	visa_10usd_002|4242****|12/27|456	2026-06-23 07:08:04.044965+00	\N	\N	\N	\N
60	45	2	available	visa_50usd_001|4242****|12/27|789	2026-06-23 07:08:04.062371+00	\N	\N	\N	\N
61	47	2	available	tw1|pass1|mail1@ex.com|cookie1	2026-06-23 07:11:17.065307+00	\N	\N	\N	\N
62	47	2	available	tw2|pass2|mail2@ex.com|cookie2	2026-06-23 07:11:17.065307+00	\N	\N	\N	\N
63	47	2	available	tw3|pass3|mail3@ex.com|cookie3	2026-06-23 07:11:17.065307+00	\N	\N	\N	\N
64	47	2	available	tw4|pass4|mail4@ex.com|cookie4	2026-06-23 07:11:17.065307+00	\N	\N	\N	\N
65	48	2	available	tw2fa1|pass|2fa_key|mail@ex.com	2026-06-23 07:11:17.102783+00	\N	\N	\N	\N
66	48	2	available	tw2fa2|pass|2fa_key|mail@ex.com	2026-06-23 07:11:17.102783+00	\N	\N	\N	\N
67	50	2	available	fb1|pass|2fa_key|mail1@hotmail.com|cookie1	2026-06-23 07:11:17.204946+00	\N	\N	\N	\N
68	50	2	available	fb2|pass|2fa_key|mail2@hotmail.com|cookie2	2026-06-23 07:11:17.204946+00	\N	\N	\N	\N
69	50	2	available	fb3|pass|2fa_key|mail3@hotmail.com|cookie3	2026-06-23 07:11:17.204946+00	\N	\N	\N	\N
70	51	2	available	fb4|pass|mail@svmail.com|cookie	2026-06-23 07:11:17.233776+00	\N	\N	\N	\N
71	51	2	available	fb5|pass|mail@svmail.com|cookie	2026-06-23 07:11:17.233776+00	\N	\N	\N	\N
72	54	2	available	tg1|+84xxx|session_data1	2026-06-23 07:11:17.355623+00	\N	\N	\N	\N
73	54	2	available	tg2|+84xxx|session_data2	2026-06-23 07:11:17.355623+00	\N	\N	\N	\N
74	54	2	available	tg3|+84xxx|session_data3	2026-06-23 07:11:17.355623+00	\N	\N	\N	\N
75	54	2	available	tg4|+84xxx|session_data4	2026-06-23 07:11:17.355623+00	\N	\N	\N	\N
76	54	2	available	tg5|+84xxx|session_data5	2026-06-23 07:11:17.355623+00	\N	\N	\N	\N
21	21	2	assigned	tw1|pass1|mail1@ex.com|cookie1	2026-06-23 07:07:18.408181+00	\N	13	2026-06-23 07:22:26.489523+00	\N
10	5	2	assigned	fb4|pass|mail@svmail.com|cookie	2026-06-22 02:34:10.708515+00	\N	14	2026-06-23 07:22:26.517868+00	\N
30	25	2	assigned	fb4|pass|mail@svmail.com|cookie	2026-06-23 07:07:18.623153+00	\N	16	2026-06-23 07:22:26.690527+00	\N
14	8	2	assigned	tg3|+84xxx|session_data3	2026-06-22 02:34:10.992808+00	\N	25	2026-06-24 04:15:10.950138+00	\N
7	4	2	assigned	fb1|pass|2fa_key|mail1@hotmail.com|cookie1	2026-06-22 02:34:10.648881+00	\N	27	2026-06-24 10:49:24.312722+00	\N
77	55	2	available	tga1|+1xxx|session_old1	2026-06-23 07:11:17.382843+00	\N	\N	\N	\N
80	58	2	available	visa_50usd_001|4242****|12/27|789	2026-06-23 07:11:17.518792+00	\N	\N	\N	\N
82	1	2	available	seed_resource_1_1|data|extra	2026-06-23 07:19:43.181201+00	\N	\N	\N	\N
83	1	2	available	seed_resource_1_2|data|extra	2026-06-23 07:19:43.181201+00	\N	\N	\N	\N
84	1	2	available	seed_resource_1_3|data|extra	2026-06-23 07:19:43.181201+00	\N	\N	\N	\N
85	1	2	available	seed_resource_1_4|data|extra	2026-06-23 07:19:43.181201+00	\N	\N	\N	\N
86	2	2	available	seed_resource_2_0|data|extra	2026-06-23 07:19:43.230456+00	\N	\N	\N	\N
87	2	2	available	seed_resource_2_1|data|extra	2026-06-23 07:19:43.230456+00	\N	\N	\N	\N
88	2	2	available	seed_resource_2_2|data|extra	2026-06-23 07:19:43.230456+00	\N	\N	\N	\N
89	2	2	available	seed_resource_2_3|data|extra	2026-06-23 07:19:43.230456+00	\N	\N	\N	\N
90	2	2	available	seed_resource_2_4|data|extra	2026-06-23 07:19:43.230456+00	\N	\N	\N	\N
91	4	2	available	seed_resource_4_0|data|extra	2026-06-23 07:19:43.284136+00	\N	\N	\N	\N
92	4	2	available	seed_resource_4_1|data|extra	2026-06-23 07:19:43.284136+00	\N	\N	\N	\N
93	4	2	available	seed_resource_4_2|data|extra	2026-06-23 07:19:43.284136+00	\N	\N	\N	\N
94	4	2	available	seed_resource_4_3|data|extra	2026-06-23 07:19:43.284136+00	\N	\N	\N	\N
95	4	2	available	seed_resource_4_4|data|extra	2026-06-23 07:19:43.284136+00	\N	\N	\N	\N
96	5	2	available	seed_resource_5_0|data|extra	2026-06-23 07:19:43.332984+00	\N	\N	\N	\N
97	5	2	available	seed_resource_5_1|data|extra	2026-06-23 07:19:43.332984+00	\N	\N	\N	\N
98	5	2	available	seed_resource_5_2|data|extra	2026-06-23 07:19:43.332984+00	\N	\N	\N	\N
99	5	2	available	seed_resource_5_3|data|extra	2026-06-23 07:19:43.332984+00	\N	\N	\N	\N
100	5	2	available	seed_resource_5_4|data|extra	2026-06-23 07:19:43.332984+00	\N	\N	\N	\N
101	8	2	available	seed_resource_8_0|data|extra	2026-06-23 07:19:43.355363+00	\N	\N	\N	\N
102	8	2	available	seed_resource_8_1|data|extra	2026-06-23 07:19:43.355363+00	\N	\N	\N	\N
103	8	2	available	seed_resource_8_2|data|extra	2026-06-23 07:19:43.355363+00	\N	\N	\N	\N
104	8	2	available	seed_resource_8_3|data|extra	2026-06-23 07:19:43.355363+00	\N	\N	\N	\N
105	8	2	available	seed_resource_8_4|data|extra	2026-06-23 07:19:43.355363+00	\N	\N	\N	\N
106	9	2	available	seed_resource_9_0|data|extra	2026-06-23 07:19:43.372985+00	\N	\N	\N	\N
107	9	2	available	seed_resource_9_1|data|extra	2026-06-23 07:19:43.372985+00	\N	\N	\N	\N
108	9	2	available	seed_resource_9_2|data|extra	2026-06-23 07:19:43.372985+00	\N	\N	\N	\N
109	9	2	available	seed_resource_9_3|data|extra	2026-06-23 07:19:43.372985+00	\N	\N	\N	\N
110	9	2	available	seed_resource_9_4|data|extra	2026-06-23 07:19:43.372985+00	\N	\N	\N	\N
111	1	2	available	seed_resource_1_0|data|extra	2026-06-23 07:22:26.243657+00	\N	\N	\N	\N
112	1	2	available	seed_resource_1_1|data|extra	2026-06-23 07:22:26.243657+00	\N	\N	\N	\N
113	1	2	available	seed_resource_1_2|data|extra	2026-06-23 07:22:26.243657+00	\N	\N	\N	\N
114	1	2	available	seed_resource_1_3|data|extra	2026-06-23 07:22:26.243657+00	\N	\N	\N	\N
115	1	2	available	seed_resource_1_4|data|extra	2026-06-23 07:22:26.243657+00	\N	\N	\N	\N
116	2	2	available	seed_resource_2_0|data|extra	2026-06-23 07:22:26.285554+00	\N	\N	\N	\N
117	2	2	available	seed_resource_2_1|data|extra	2026-06-23 07:22:26.285554+00	\N	\N	\N	\N
118	2	2	available	seed_resource_2_2|data|extra	2026-06-23 07:22:26.285554+00	\N	\N	\N	\N
119	2	2	available	seed_resource_2_3|data|extra	2026-06-23 07:22:26.285554+00	\N	\N	\N	\N
120	2	2	available	seed_resource_2_4|data|extra	2026-06-23 07:22:26.285554+00	\N	\N	\N	\N
121	4	2	available	seed_resource_4_0|data|extra	2026-06-23 07:22:26.298368+00	\N	\N	\N	\N
122	4	2	available	seed_resource_4_1|data|extra	2026-06-23 07:22:26.298368+00	\N	\N	\N	\N
123	4	2	available	seed_resource_4_2|data|extra	2026-06-23 07:22:26.298368+00	\N	\N	\N	\N
124	4	2	available	seed_resource_4_3|data|extra	2026-06-23 07:22:26.298368+00	\N	\N	\N	\N
125	4	2	available	seed_resource_4_4|data|extra	2026-06-23 07:22:26.298368+00	\N	\N	\N	\N
126	5	2	available	seed_resource_5_0|data|extra	2026-06-23 07:22:26.312+00	\N	\N	\N	\N
127	5	2	available	seed_resource_5_1|data|extra	2026-06-23 07:22:26.312+00	\N	\N	\N	\N
128	5	2	available	seed_resource_5_2|data|extra	2026-06-23 07:22:26.312+00	\N	\N	\N	\N
129	5	2	available	seed_resource_5_3|data|extra	2026-06-23 07:22:26.312+00	\N	\N	\N	\N
130	5	2	available	seed_resource_5_4|data|extra	2026-06-23 07:22:26.312+00	\N	\N	\N	\N
131	8	2	available	seed_resource_8_0|data|extra	2026-06-23 07:22:26.32611+00	\N	\N	\N	\N
132	8	2	available	seed_resource_8_1|data|extra	2026-06-23 07:22:26.32611+00	\N	\N	\N	\N
133	8	2	available	seed_resource_8_2|data|extra	2026-06-23 07:22:26.32611+00	\N	\N	\N	\N
134	8	2	available	seed_resource_8_3|data|extra	2026-06-23 07:22:26.32611+00	\N	\N	\N	\N
135	8	2	available	seed_resource_8_4|data|extra	2026-06-23 07:22:26.32611+00	\N	\N	\N	\N
136	9	2	available	seed_resource_9_0|data|extra	2026-06-23 07:22:26.339007+00	\N	\N	\N	\N
137	9	2	available	seed_resource_9_1|data|extra	2026-06-23 07:22:26.339007+00	\N	\N	\N	\N
138	9	2	available	seed_resource_9_2|data|extra	2026-06-23 07:22:26.339007+00	\N	\N	\N	\N
139	9	2	available	seed_resource_9_3|data|extra	2026-06-23 07:22:26.339007+00	\N	\N	\N	\N
140	9	2	available	seed_resource_9_4|data|extra	2026-06-23 07:22:26.339007+00	\N	\N	\N	\N
81	1	2	assigned	seed_resource_1_0|data|extra	2026-06-23 07:19:43.181201+00	\N	12	2026-06-23 07:22:26.43312+00	\N
78	57	2	error	visa_10usd_001|4242****|12/27|123	2026-06-23 07:11:17.490085+00	\N	\N	\N	\N
79	57	2	error	visa_10usd_002|4242****|12/27|456	2026-06-23 07:11:17.490085+00	\N	\N	\N	\N
141	58	2	available	abc	2026-06-23 09:32:47.41492+00	\N	\N	\N	\N
142	58	2	available	def	2026-06-23 09:32:47.41492+00	\N	\N	\N	\N
143	57	2	available	a	2026-06-23 09:32:58.921395+00	\N	\N	\N	\N
144	57	2	available	b	2026-06-23 09:32:58.921395+00	\N	\N	\N	\N
151	61	2	available	tw1|pass1|mail1@ex.com|cookie1	2026-06-24 03:33:24.639227+00	\N	\N	\N	\N
152	61	2	available	tw2|pass2|mail2@ex.com|cookie2	2026-06-24 03:33:24.639227+00	\N	\N	\N	\N
153	61	2	available	tw3|pass3|mail3@ex.com|cookie3	2026-06-24 03:33:24.639227+00	\N	\N	\N	\N
154	61	2	available	tw4|pass4|mail4@ex.com|cookie4	2026-06-24 03:33:24.639227+00	\N	\N	\N	\N
155	62	2	available	tw2fa1|pass|2fa_key|mail@ex.com	2026-06-24 03:33:24.692964+00	\N	\N	\N	\N
156	62	2	available	tw2fa2|pass|2fa_key|mail@ex.com	2026-06-24 03:33:24.692964+00	\N	\N	\N	\N
157	64	2	available	fb1|pass|2fa_key|mail1@hotmail.com|cookie1	2026-06-24 03:33:24.837396+00	\N	\N	\N	\N
158	64	2	available	fb2|pass|2fa_key|mail2@hotmail.com|cookie2	2026-06-24 03:33:24.837396+00	\N	\N	\N	\N
159	64	2	available	fb3|pass|2fa_key|mail3@hotmail.com|cookie3	2026-06-24 03:33:24.837396+00	\N	\N	\N	\N
160	65	2	available	fb4|pass|mail@svmail.com|cookie	2026-06-24 03:33:24.875466+00	\N	\N	\N	\N
161	65	2	available	fb5|pass|mail@svmail.com|cookie	2026-06-24 03:33:24.875466+00	\N	\N	\N	\N
162	68	2	available	tg1|+84xxx|session_data1	2026-06-24 03:33:25.043434+00	\N	\N	\N	\N
163	68	2	available	tg2|+84xxx|session_data2	2026-06-24 03:33:25.043434+00	\N	\N	\N	\N
164	68	2	available	tg3|+84xxx|session_data3	2026-06-24 03:33:25.043434+00	\N	\N	\N	\N
165	68	2	available	tg4|+84xxx|session_data4	2026-06-24 03:33:25.043434+00	\N	\N	\N	\N
166	68	2	available	tg5|+84xxx|session_data5	2026-06-24 03:33:25.043434+00	\N	\N	\N	\N
167	69	2	available	tga1|+1xxx|session_old1	2026-06-24 03:33:25.083721+00	\N	\N	\N	\N
168	71	2	available	visa_10usd_001|4242****|12/27|123	2026-06-24 03:33:25.230738+00	\N	\N	\N	\N
169	71	2	available	visa_10usd_002|4242****|12/27|456	2026-06-24 03:33:25.230738+00	\N	\N	\N	\N
170	72	2	available	visa_50usd_001|4242****|12/27|789	2026-06-24 03:33:25.267252+00	\N	\N	\N	\N
\.


--
-- Data for Name: seller_applications; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.seller_applications (id, account_id, business_name, description, contact, status, reject_reason, created_at) FROM stdin;
\.


--
-- Data for Name: service_tasks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.service_tasks (id, order_id, platform, target_url, status, assignee, result_data, created_at, updated_at) FROM stdin;
6	21	facebook	https://fb.com/page/scam-shop	pending	\N	\N	2026-06-23 07:22:26.862972+00	2026-06-23 07:22:26.862972+00
4	21	facebook	https://fb.com/post/123456	completed	Hùng	Takedown thành công. Facebook đã xoá bài.	2026-06-23 07:22:26.862972+00	2026-06-23 07:22:26.862972+00
5	21	facebook	https://fb.com/post/789012	processing	Minh	\N	2026-06-23 07:22:26.862972+00	2026-06-23 07:22:26.862972+00
7	24	youtube	https://www.youtube.com/channel/UCmYesELO6axBrCuSpf7S9DQ	pending	\N	\N	2026-06-23 07:29:34.250708+00	2026-06-23 07:29:34.250708+00
\.


--
-- Data for Name: transactions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.transactions (id, wallet_id, type, amount, description, reference_id, created_at) FROM stdin;
1	3	topup	5000000	Admin topup	\N	2026-06-22 02:34:11.997176+00
2	1	topup	100000	Admin topup	\N	2026-06-22 02:35:18.020523+00
3	1	purchase_hold	18000	Mua Telegram số ảo — Session + JSON — Session + JSON (x1)	order-pending	2026-06-22 02:35:24.157405+00
4	1	purchase_hold	45000	Mua Telegram số ảo — Session + JSON — Cổ 1 năm, không spam (x1)	order-pending	2026-06-22 02:36:37.077531+00
5	1	topup	100000	Admin topup	\N	2026-06-22 02:36:56.292721+00
8	2	purchase_release	45000	Order payment	order-2	2026-06-22 02:37:28.010215+00
9	2	purchase_release	17100	Order payment	order-1	2026-06-22 02:38:48.634944+00
10	1	platform_fee	900	Platform fee	order-1	2026-06-22 02:38:48.634944+00
11	1	purchase_hold	59000	Mua Twitter cổ 2020+ — Trust cao — Full 2FA + email (x1)	order-pending	2026-06-22 02:48:11.573662+00
12	1	purchase_hold	25000	Mua Twitter cổ 2020+ — Trust cao — Email + cookies (x1)	order-pending	2026-06-22 02:48:52.222541+00
13	1	purchase_hold	25000	Mua Twitter cổ 2020+ — Trust cao — Email + cookies (x1)	order-pending	2026-06-22 02:53:23.242073+00
14	1	purchase_hold	25000	Mua Twitter cổ 2020+ — Trust cao — Email + cookies (x1)	order-pending	2026-06-22 02:53:29.316644+00
15	1	topup	100000	Admin topup	\N	2026-06-22 03:03:27.061539+00
16	1	topup	500000	Admin topup	\N	2026-06-22 03:03:27.62946+00
17	1	refund	25000	Order refund	order-8	2026-06-22 03:05:35.357595+00
18	2	topup	500000	Admin topup	\N	2026-06-22 03:22:49.421181+00
19	1	purchase_hold	150000	Mua VPS Cloud KVM — SSD NVMe — Basic — 2 vCPU / 2GB RAM / 40GB SSD (x1)	order-pending	2026-06-22 03:38:58.572427+00
20	3	purchase_hold	25000	Mua Twitter cổ 2020+ — Trust cao — Email + cookies (x1)	order-pending	2026-06-22 04:03:49.978624+00
21	1	purchase_hold	18000	Mua Telegram số ảo — Session + JSON — Session + JSON (x1)	order-pending	2026-06-22 05:49:56.298873+00
22	2	purchase_release	17100	Order payment	order-11	2026-06-22 05:50:22.049226+00
23	1	platform_fee	900	Platform fee	order-11	2026-06-22 05:50:22.049226+00
24	1	topup	100000	Admin topup	\N	2026-06-22 07:25:48.459501+00
25	1	refund	150000	Order refund	order-9	2026-06-23 03:40:52.53437+00
26	3	topup	5000000	Admin topup	\N	2026-06-23 07:07:19.095999+00
27	3	topup	5000000	Admin topup	\N	2026-06-23 07:08:04.077101+00
28	3	topup	5000000	Admin topup	\N	2026-06-23 07:11:17.542722+00
29	3	topup	10000000	Admin topup	\N	2026-06-23 07:17:29.018452+00
30	1	topup	5000000	Admin topup	\N	2026-06-23 07:17:29.685743+00
31	3	topup	10000000	Admin topup	\N	2026-06-23 07:19:43.140646+00
32	1	topup	5000000	Admin topup	\N	2026-06-23 07:19:44.001213+00
33	3	topup	10000000	Admin topup	\N	2026-06-23 07:22:26.182409+00
34	3	purchase_hold	25000	Mua Twitter cổ 2020+ — Trust cao — Email + cookies (x1)	order-pending	2026-06-23 07:22:26.39572+00
35	2	purchase_release	25000	Order payment	order-12	2026-06-23 07:22:26.456128+00
36	3	purchase_hold	25000	Mua Twitter cổ 2020+ — Trust cao — Email + cookies (x1)	order-pending	2026-06-23 07:22:26.480351+00
37	3	purchase_hold	28000	Mua Facebook Clone Việt cổ — ACC Name Việt cổ | UID 10000xxx | Mail SVMail | No2FA (x1)	order-pending	2026-06-23 07:22:26.502222+00
38	2	purchase_release	28000	Order payment	order-14	2026-06-23 07:22:26.534926+00
39	3	purchase_hold	15000	Mua Telegram số ảo — Session + JSON — Bulk 100+ (theo yêu cầu) (x1)	order-pending	2026-06-23 07:22:26.652172+00
40	3	purchase_hold	28000	Mua Facebook Clone Việt cổ — ACC Name Việt cổ | UID 10000xxx | Mail SVMail | No2FA (x1)	order-pending	2026-06-23 07:22:26.680853+00
41	2	purchase_release	28000	Order payment	order-16	2026-06-23 07:22:26.704256+00
42	3	purchase_hold	290000	Mua Twitter cổ 2020+ — Trust cao — Đặt sỉ theo yêu cầu (50+) (x1)	order-pending	2026-06-23 07:22:26.743771+00
43	3	purchase_hold	120000	Mua Proxy dân cư — Trust cao, Anti Detect mạnh (x1)	order-pending	2026-06-23 07:22:26.769109+00
44	3	purchase_hold	149625	Mua Proxy dân cư — Trust cao, Anti Detect mạnh (x1)	order-pending	2026-06-23 07:22:26.804055+00
45	3	purchase_hold	47500	Mua TikTok Scraper API — Data extraction (x1)	order-pending	2026-06-23 07:22:26.83609+00
46	3	purchase_hold	1500000	Mua Takedown Facebook / TikTok / YouTube (x1)	order-pending	2026-06-23 07:22:26.862972+00
47	1	topup	5000000	Admin topup	\N	2026-06-23 07:22:26.914707+00
48	1	purchase_hold	30000	Mua Telegram số ảo — Session + JSON — Bulk 100+ (theo yêu cầu) (x2)	order-pending	2026-06-23 07:22:26.932148+00
49	1	purchase_hold	10000	Mua TikTok Scraper API — Data extraction (x1)	order-pending	2026-06-23 07:28:27.335687+00
50	2	purchase_release	10000	Order payment	order-23	2026-06-23 07:28:41.894206+00
51	1	purchase_hold	750000	Mua Takedown Facebook / TikTok / YouTube (x1)	order-pending	2026-06-23 07:29:34.250708+00
52	1	refund	750000	Order refund	order-24	2026-06-23 09:28:23.127868+00
53	3	topup	5000000	Admin topup	\N	2026-06-24 03:33:25.3041+00
54	3	purchase_hold	18000	Mua Telegram số ảo — Session + JSON — Session + JSON (x1)	order-pending	2026-06-24 04:15:10.888693+00
55	3	purchase_hold	15750	Mua Proxy dân cư — Trust cao, Anti Detect mạnh (x1)	order-pending	2026-06-24 04:17:11.21847+00
56	1	purchase_hold	35000	Mua Facebook Clone Việt cổ — Clone Việt 5-30 Posts | 30-1000 BB | REG 6.2025 | Avatar | Hotmail | Full 2FA (x1)	order-pending	2026-06-24 10:49:24.268298+00
57	2	purchase_release	33250	Order payment	order-27	2026-06-24 11:04:59.173268+00
58	1	platform_fee	1750	Platform fee	order-27	2026-06-24 11:04:59.173268+00
59	1	refund	25000	Order refund	order-7	2026-06-24 11:05:30.105046+00
60	2	purchase_release	56050	Order payment	order-5	2026-06-25 03:09:43.267046+00
61	1	platform_fee	2950	Platform fee	order-5	2026-06-25 03:09:43.267046+00
62	2	purchase_release	23750	Order payment	order-6	2026-06-25 03:09:43.267046+00
63	1	platform_fee	1250	Platform fee	order-6	2026-06-25 03:09:43.267046+00
64	2	purchase_release	23750	Order payment	order-10	2026-06-25 04:09:43.266647+00
65	1	platform_fee	1250	Platform fee	order-10	2026-06-25 04:09:43.266647+00
66	2	purchase_release	23750	Order payment	order-13	2026-06-26 07:46:43.854889+00
67	1	platform_fee	1250	Platform fee	order-13	2026-06-26 07:46:43.854889+00
68	2	purchase_release	114000	Order payment	order-18	2026-06-26 07:46:43.854889+00
69	1	platform_fee	6000	Platform fee	order-18	2026-06-26 07:46:43.854889+00
70	2	purchase_release	142144	Order payment	order-19	2026-06-26 07:46:43.854889+00
71	1	platform_fee	7481	Platform fee	order-19	2026-06-26 07:46:43.854889+00
72	2	purchase_release	45125	Order payment	order-20	2026-06-26 07:46:43.854889+00
73	1	platform_fee	2375	Platform fee	order-20	2026-06-26 07:46:43.854889+00
74	2	purchase_release	1425000	Order payment	order-21	2026-06-26 07:46:43.854889+00
75	1	platform_fee	75000	Platform fee	order-21	2026-06-26 07:46:43.854889+00
76	2	purchase_release	290000	Order payment	order-17	2026-06-26 10:21:57.233014+00
77	2	purchase_release	18000	Order payment	order-25	2026-06-29 02:46:52.633744+00
78	2	purchase_release	15750	Order payment	order-26	2026-06-29 02:46:52.633744+00
\.


--
-- Data for Name: wallets; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.wallets (id, account_id, balance, updated_at) FROM stdin;
3	3	52713125	2026-06-24 04:17:11.21847+00
1	1	15761106	2026-06-26 07:46:43.854889+00
2	2	2880769	2026-06-29 02:46:52.633744+00
\.


--
-- Data for Name: withdraw_requests; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.withdraw_requests (id, account_id, amount, status, created_at) FROM stdin;
\.


--
-- Name: accounts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.accounts_id_seq', 3, true);


--
-- Name: alerts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.alerts_id_seq', 4, true);


--
-- Name: categories_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.categories_id_seq', 7, true);


--
-- Name: disputes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.disputes_id_seq', 6, true);


--
-- Name: log_entries_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.log_entries_id_seq', 78, true);


--
-- Name: orders_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.orders_id_seq', 27, true);


--
-- Name: pricing_configs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.pricing_configs_id_seq', 28, true);


--
-- Name: product_variants_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.product_variants_id_seq', 74, true);


--
-- Name: products_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.products_id_seq', 26, true);


--
-- Name: provider_health_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.provider_health_id_seq', 7688, true);


--
-- Name: providers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.providers_id_seq', 5, true);


--
-- Name: resources_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.resources_id_seq', 172, true);


--
-- Name: seller_applications_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.seller_applications_id_seq', 1, false);


--
-- Name: service_tasks_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.service_tasks_id_seq', 13, true);


--
-- Name: transactions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.transactions_id_seq', 78, true);


--
-- Name: wallets_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.wallets_id_seq', 3, true);


--
-- Name: withdraw_requests_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.withdraw_requests_id_seq', 1, false);


--
-- Name: accounts accounts_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_email_key UNIQUE (email);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: alembic_version alembic_version_pkc; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alembic_version
    ADD CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num);


--
-- Name: alerts alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_pkey PRIMARY KEY (id);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: categories categories_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_slug_key UNIQUE (slug);


--
-- Name: disputes disputes_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputes
    ADD CONSTRAINT disputes_order_id_key UNIQUE (order_id);


--
-- Name: disputes disputes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputes
    ADD CONSTRAINT disputes_pkey PRIMARY KEY (id);


--
-- Name: log_entries log_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.log_entries
    ADD CONSTRAINT log_entries_pkey PRIMARY KEY (id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: pricing_configs pricing_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_configs
    ADD CONSTRAINT pricing_configs_pkey PRIMARY KEY (id);


--
-- Name: pricing_configs pricing_configs_service_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_configs
    ADD CONSTRAINT pricing_configs_service_type_key UNIQUE (service_type);


--
-- Name: product_variants product_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: provider_health provider_health_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_health
    ADD CONSTRAINT provider_health_pkey PRIMARY KEY (id);


--
-- Name: providers providers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.providers
    ADD CONSTRAINT providers_pkey PRIMARY KEY (id);


--
-- Name: resources resources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resources
    ADD CONSTRAINT resources_pkey PRIMARY KEY (id);


--
-- Name: seller_applications seller_applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_applications
    ADD CONSTRAINT seller_applications_pkey PRIMARY KEY (id);


--
-- Name: service_tasks service_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_tasks
    ADD CONSTRAINT service_tasks_pkey PRIMARY KEY (id);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: wallets wallets_account_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_account_id_key UNIQUE (account_id);


--
-- Name: wallets wallets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_pkey PRIMARY KEY (id);


--
-- Name: withdraw_requests withdraw_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.withdraw_requests
    ADD CONSTRAINT withdraw_requests_pkey PRIMARY KEY (id);


--
-- Name: ix_log_entries_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_log_entries_job_id ON public.log_entries USING btree (job_id);


--
-- Name: ix_log_entries_request_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_log_entries_request_id ON public.log_entries USING btree (request_id);


--
-- Name: categories categories_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.categories(id);


--
-- Name: disputes disputes_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputes
    ADD CONSTRAINT disputes_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.accounts(id);


--
-- Name: disputes disputes_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputes
    ADD CONSTRAINT disputes_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: products fk_products_provider; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT fk_products_provider FOREIGN KEY (provider_id) REFERENCES public.providers(id);


--
-- Name: providers fk_providers_fallback; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.providers
    ADD CONSTRAINT fk_providers_fallback FOREIGN KEY (fallback_provider_id) REFERENCES public.providers(id);


--
-- Name: resources fk_resources_order; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resources
    ADD CONSTRAINT fk_resources_order FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: resources fk_resources_provider; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resources
    ADD CONSTRAINT fk_resources_provider FOREIGN KEY (provider_id) REFERENCES public.providers(id);


--
-- Name: orders orders_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.accounts(id);


--
-- Name: orders orders_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: orders orders_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.accounts(id);


--
-- Name: orders orders_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id);


--
-- Name: product_variants product_variants_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: products products_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id);


--
-- Name: products products_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.accounts(id);


--
-- Name: provider_health provider_health_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_health
    ADD CONSTRAINT provider_health_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.providers(id);


--
-- Name: resources resources_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resources
    ADD CONSTRAINT resources_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.accounts(id);


--
-- Name: resources resources_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resources
    ADD CONSTRAINT resources_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id);


--
-- Name: service_tasks service_tasks_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_tasks
    ADD CONSTRAINT service_tasks_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: transactions transactions_wallet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES public.wallets(id);


--
-- Name: wallets wallets_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: withdraw_requests withdraw_requests_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.withdraw_requests
    ADD CONSTRAINT withdraw_requests_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- PostgreSQL database dump complete
--


