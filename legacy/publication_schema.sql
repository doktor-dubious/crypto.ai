-- MySQL dump 10.13  Distrib 8.4.8, for Linux (x86_64)
--
-- Host: localhost    Database: publication
-- ------------------------------------------------------
-- Server version	8.4.8-0ubuntu0.25.10.1

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `admin_code_name`
--

DROP TABLE IF EXISTS `admin_code_name`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `admin_code_name` (
  `admin_code_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `code_group` varchar(32) NOT NULL,
  `code_name` varchar(128) NOT NULL,
  `code_index` mediumint NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`admin_code_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB AUTO_INCREMENT=29 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `admin_configuration`
--

DROP TABLE IF EXISTS `admin_configuration`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `admin_configuration` (
  `admin_configuration_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `production_class_id` int unsigned NOT NULL DEFAULT '0',
  `cassandra_profile` varchar(64) NOT NULL DEFAULT '',
  `ftp_in` varchar(64) NOT NULL DEFAULT '',
  `ftp_out` varchar(64) NOT NULL DEFAULT '',
  `draw_mail_from_email` varchar(64) NOT NULL DEFAULT '',
  `draw_mail_from_name` varchar(64) NOT NULL DEFAULT '',
  `draw_mail_to_email` varchar(64) NOT NULL DEFAULT '',
  `draw_mail_to_name` varchar(64) NOT NULL DEFAULT '',
  `draw_mail_cc_email` varchar(256) NOT NULL DEFAULT '',
  `draw_mail_cc_name` varchar(256) NOT NULL DEFAULT '',
  `draw_mail_bcc_email` varchar(256) NOT NULL DEFAULT '',
  `draw_mail_bcc_name` varchar(256) NOT NULL DEFAULT '',
  `draw_mail_subject` varchar(64) NOT NULL DEFAULT '',
  `draw_mail_message` text NOT NULL,
  `draw_filename` varchar(64) NOT NULL DEFAULT '',
  `draw_separator` varchar(16) NOT NULL DEFAULT '',
  `draw_date_format` varchar(16) NOT NULL DEFAULT '',
  `draw_number_format` tinyint NOT NULL DEFAULT '1',
  `line_format` tinyint NOT NULL DEFAULT '1',
  `outlet__sublets` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__phone_number` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__street_and_number` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__city_name` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__city_code` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__us_state_name` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__zip_name` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__zip_id` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__county_id` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__municipality_id` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__district` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__sub_district` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__country_id` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__longitude` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__latitude` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__publication` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__carrier` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__branch` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__product` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__truck` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__sc_type` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__tariff_model` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__outlet_type` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__outlet_type_2` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__zone_id` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__zone_id_text` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__rate_class_id` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__pay_type` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__chain_id` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__area` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__dc` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__scan_account` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__delayed_return` tinyint(1) NOT NULL DEFAULT '0',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ftp_login` varchar(64) NOT NULL DEFAULT '',
  `ftp_password` varchar(64) NOT NULL DEFAULT '',
  `ftp_store_data` varchar(64) NOT NULL DEFAULT '',
  `ftp_store_draw` varchar(64) NOT NULL DEFAULT '',
  `store_data_files` tinyint(1) NOT NULL DEFAULT '1',
  `store_draw_files` tinyint(1) NOT NULL DEFAULT '1',
  `draw_header` tinyint(1) NOT NULL DEFAULT '0',
  `draw_line` varchar(512) NOT NULL DEFAULT '',
  `debug_class_id` int unsigned NOT NULL DEFAULT '0',
  `outlet__sub_truck` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__allow_return` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__allow_forecast` tinyint(1) NOT NULL DEFAULT '0',
  `ftp_server_ip` varchar(16) NOT NULL DEFAULT '',
  `ftp_alternative_server_ip` varchar(16) NOT NULL DEFAULT '',
  `season_group_minimum` tinyint NOT NULL DEFAULT '10',
  `import_default_template` int unsigned DEFAULT NULL,
  `export_draw_default_template` int unsigned DEFAULT NULL,
  `import_default_tariff_template` tinyint NOT NULL DEFAULT '1',
  `ftp_home` varchar(64) NOT NULL DEFAULT '',
  `sales_data_cache_length` tinyint NOT NULL DEFAULT '6',
  `simulate__outlet_class_id` int unsigned NOT NULL DEFAULT '0',
  `simulate__contemporary` tinyint(1) NOT NULL DEFAULT '0',
  `simulate__track` mediumint unsigned NOT NULL DEFAULT '0',
  `simulate__strategy_template_id` int unsigned NOT NULL DEFAULT '0',
  `simulate__simulation_type` tinyint NOT NULL DEFAULT '1',
  `simulate__export_separator` varchar(4) NOT NULL DEFAULT ';',
  `simulate__export_date_format` varchar(16) NOT NULL DEFAULT 'MM/DD/YYYY',
  `simulate__decimal_separator` varchar(4) NOT NULL DEFAULT '.',
  `issues__unreasonable_tariff_upper` float unsigned NOT NULL DEFAULT '20',
  `issues__unreasonable_tariff_lower` float unsigned NOT NULL DEFAULT '1',
  `export_default_template` int unsigned DEFAULT NULL,
  `outlet__custom_1` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__custom_2` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__custom_3` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__custom_4` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__custom_5` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__notes` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__instructions` tinyint(1) NOT NULL DEFAULT '0',
  `outlet__drop_location` tinyint(1) NOT NULL DEFAULT '0',
  `currency` varchar(12) NOT NULL DEFAULT '$',
  `import_verification_count` int NOT NULL DEFAULT '500',
  `sales_data_cache_zipped` tinyint(1) NOT NULL DEFAULT '1',
  `sales_data_cache` tinyint(1) NOT NULL DEFAULT '1',
  `sales_data_cache_db` tinyint(1) NOT NULL DEFAULT '1',
  `issues__missing_sales_period` tinyint unsigned NOT NULL DEFAULT '60',
  `issues__sold_out_sales_period` tinyint unsigned NOT NULL DEFAULT '60',
  `issues__sold_out_sales_count` tinyint unsigned NOT NULL DEFAULT '3',
  `issues__return_pct_period` tinyint unsigned NOT NULL DEFAULT '3',
  `issues__return_pct_amount` tinyint unsigned NOT NULL DEFAULT '75',
  `directory__home` varchar(32) NOT NULL DEFAULT '',
  `directory__data` varchar(32) NOT NULL DEFAULT '',
  `directory__data_store` varchar(32) NOT NULL DEFAULT '',
  `directory__draw` varchar(32) NOT NULL DEFAULT '',
  `directory__draw_store` varchar(32) NOT NULL DEFAULT '',
  `directory__log` varchar(32) NOT NULL DEFAULT '',
  `directory__log_store` varchar(32) NOT NULL DEFAULT '',
  `cache_last_updated` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_import` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `default_stat_profile_sales` int unsigned NOT NULL DEFAULT '0',
  `default_stat_profile_return` int unsigned NOT NULL DEFAULT '0',
  `default_stat_profile_outlet` int unsigned NOT NULL DEFAULT '0',
  `default_stat_profile_scan_overview` int unsigned NOT NULL DEFAULT '0',
  `default_stat_profile_scan_outlet` int unsigned NOT NULL DEFAULT '0',
  `default_stat_profile_profit_date` int unsigned NOT NULL DEFAULT '0',
  `default_stat_profile_profit_outlet` int unsigned NOT NULL DEFAULT '0',
  `default_statistics_profile` int unsigned NOT NULL DEFAULT '0',
  `delayed_return` tinyint NOT NULL DEFAULT '0',
  `monday_default_minmum_draw` tinyint NOT NULL DEFAULT '1',
  `tuesday_default_minmum_draw` tinyint NOT NULL DEFAULT '1',
  `wednesday_default_minmum_draw` tinyint NOT NULL DEFAULT '1',
  `thursday_default_minmum_draw` tinyint NOT NULL DEFAULT '1',
  `friday_default_minmum_draw` tinyint NOT NULL DEFAULT '1',
  `saturday_default_minmum_draw` tinyint NOT NULL DEFAULT '1',
  `sunday_default_minmum_draw` tinyint NOT NULL DEFAULT '1',
  `monday_default_cost_per_unit` float NOT NULL DEFAULT '0',
  `tuesday_default_cost_per_unit` float NOT NULL DEFAULT '0',
  `wednesday_default_cost_per_unit` float NOT NULL DEFAULT '0',
  `thursday_default_cost_per_unit` float NOT NULL DEFAULT '0',
  `friday_default_cost_per_unit` float NOT NULL DEFAULT '0',
  `saturday_default_cost_per_unit` float NOT NULL DEFAULT '0',
  `sunday_default_cost_per_unit` float NOT NULL DEFAULT '0',
  `monday_default_profit_per_unit` float NOT NULL DEFAULT '0',
  `tuesday_default_profit_per_unit` float NOT NULL DEFAULT '0',
  `wednesday_default_profit_per_unit` float NOT NULL DEFAULT '0',
  `thursday_default_profit_per_unit` float NOT NULL DEFAULT '0',
  `friday_default_profit_per_unit` float NOT NULL DEFAULT '0',
  `saturday_default_profit_per_unit` float NOT NULL DEFAULT '0',
  `sunday_default_profit_per_unit` float NOT NULL DEFAULT '0',
  `monday_draw_optional` tinyint NOT NULL DEFAULT '1',
  `tuesday_draw_optional` tinyint NOT NULL DEFAULT '1',
  `wednesday_draw_optional` tinyint NOT NULL DEFAULT '1',
  `thursday_draw_optional` tinyint NOT NULL DEFAULT '1',
  `friday_draw_optional` tinyint NOT NULL DEFAULT '1',
  `saturday_draw_optional` tinyint NOT NULL DEFAULT '1',
  `sunday_draw_optional` tinyint NOT NULL DEFAULT '1',
  `sales_data_cache_mark` varchar(16) NOT NULL DEFAULT '',
  `issues_monday` tinyint(1) NOT NULL DEFAULT '1',
  `issues_tuesday` tinyint(1) NOT NULL DEFAULT '1',
  `issues_wednesday` tinyint(1) NOT NULL DEFAULT '1',
  `issues_thursday` tinyint(1) NOT NULL DEFAULT '1',
  `issues_friday` tinyint(1) NOT NULL DEFAULT '1',
  `issues_saturday` tinyint(1) NOT NULL DEFAULT '1',
  `issues_sunday` tinyint(1) NOT NULL DEFAULT '1',
  `outlet_analytics__max` tinyint unsigned NOT NULL DEFAULT '6',
  `issues__zero_sale_method` tinyint unsigned NOT NULL DEFAULT '1',
  `issues__zero_sale_period` tinyint unsigned NOT NULL DEFAULT '60',
  `issues__return_pct_lower_draw_bound` tinyint unsigned NOT NULL DEFAULT '3',
  `issues__lars_observation_count` tinyint unsigned NOT NULL DEFAULT '4',
  `issues__lars_minimum_draw` tinyint unsigned NOT NULL DEFAULT '20',
  `issues__lars_minimum_scan_sold` tinyint unsigned NOT NULL DEFAULT '2',
  `issues__lars_flag_count` tinyint unsigned NOT NULL DEFAULT '2',
  `location` varchar(64) NOT NULL DEFAULT '',
  `time_zone` varchar(64) NOT NULL DEFAULT '',
  `utc_offset` tinyint NOT NULL DEFAULT '0',
  `email_template_id` int unsigned NOT NULL DEFAULT '0',
  `issues__max_sales_data` int unsigned NOT NULL DEFAULT '5000',
  `issues__max_tariff` int unsigned NOT NULL DEFAULT '5000',
  `issues__max_pad` int unsigned NOT NULL DEFAULT '5000',
  `issues__max_season_group` int unsigned NOT NULL DEFAULT '5000',
  `outlet_analytics__outlier_draw_max` tinyint unsigned NOT NULL DEFAULT '7',
  `outlet_analytics__outlier_draw_mul` tinyint unsigned NOT NULL DEFAULT '3',
  `outlet_analytics__outlier_sales_max` tinyint unsigned NOT NULL DEFAULT '7',
  `outlet_analytics__outlier_sales_mul` tinyint unsigned NOT NULL DEFAULT '3',
  `outlet_analytics__outlier_return_max` tinyint unsigned NOT NULL DEFAULT '7',
  `outlet_analytics__outlier_return_mul` tinyint unsigned NOT NULL DEFAULT '3',
  `issues__last_updated` timestamp NOT NULL DEFAULT '2000-01-01 00:00:00',
  `seasons__last_updated` timestamp NOT NULL DEFAULT '2000-01-01 00:00:00',
  PRIMARY KEY (`admin_configuration_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB AUTO_INCREMENT=118 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `admin_log`
--

DROP TABLE IF EXISTS `admin_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `admin_log` (
  `admin_log_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `user_id` int unsigned NOT NULL,
  `update_type` tinyint unsigned NOT NULL,
  `function_name` varchar(255) NOT NULL,
  `table_name` varchar(255) NOT NULL,
  `id` int unsigned NOT NULL,
  `description` varchar(32) NOT NULL,
  `sql_query` text NOT NULL,
  `comments` text NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`admin_log_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB AUTO_INCREMENT=2400871 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `admin_map`
--

DROP TABLE IF EXISTS `admin_map`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `admin_map` (
  `admin_map_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `database_name` varchar(64) NOT NULL,
  `publication_name` varchar(64) NOT NULL,
  `description` varchar(255) NOT NULL DEFAULT '',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`admin_map_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB AUTO_INCREMENT=1349 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `admin_tariff`
--

DROP TABLE IF EXISTS `admin_tariff`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `admin_tariff` (
  `admin_tariff_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `name` varchar(64) NOT NULL,
  `description` varchar(255) NOT NULL DEFAULT '',
  `day_of_week` tinyint NOT NULL,
  `cost_per_day` float NOT NULL,
  `profit_per_day` float NOT NULL,
  `cost_per_unit` float NOT NULL,
  `profit_per_unit` float NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `outlet_group_id` int unsigned NOT NULL,
  `start_date` date NOT NULL DEFAULT '2010-01-01',
  `end_date` date NOT NULL DEFAULT '2010-01-01',
  `applied` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`admin_tariff_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB AUTO_INCREMENT=39 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `admin_task`
--

DROP TABLE IF EXISTS `admin_task`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `admin_task` (
  `admin_task_id` int unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int unsigned NOT NULL,
  `publication_id` int unsigned NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` text NOT NULL,
  `day_of_week` tinyint unsigned NOT NULL DEFAULT '1',
  `day_of_month` tinyint unsigned NOT NULL DEFAULT '1',
  `date_of_year` date NOT NULL,
  `task_type` tinyint unsigned NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`admin_task_id`),
  KEY `user_id` (`user_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `airport`
--

DROP TABLE IF EXISTS `airport`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `airport` (
  `airport_id` int unsigned NOT NULL AUTO_INCREMENT,
  `country_id` smallint unsigned NOT NULL,
  `city_id` int unsigned NOT NULL DEFAULT '0',
  `airport_name` varchar(255) NOT NULL DEFAULT '',
  `airport_name_local` varchar(255) NOT NULL DEFAULT '',
  `iata` char(3) NOT NULL DEFAULT '',
  `icao` char(4) NOT NULL DEFAULT '',
  `longitude` char(9) NOT NULL DEFAULT '',
  `latitude` char(9) NOT NULL DEFAULT '',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT '0000-00-00 00:00:00',
  PRIMARY KEY (`airport_id`),
  UNIQUE KEY `airport_name` (`airport_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `alpha`
--

DROP TABLE IF EXISTS `alpha`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `alpha` (
  `alpha_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `outlet_id` int unsigned NOT NULL,
  `day_of_week` tinyint NOT NULL,
  `alpha` decimal(12,6) NOT NULL DEFAULT '0.000000',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`alpha_id`),
  KEY `publication_id` (`publication_id`),
  KEY `outlet_id` (`outlet_id`)
) ENGINE=InnoDB AUTO_INCREMENT=246112929 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `alpha_exclude`
--

DROP TABLE IF EXISTS `alpha_exclude`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `alpha_exclude` (
  `alpha_exclude_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `comment` text NOT NULL,
  `exclude_date` date NOT NULL,
  `day_of_week` tinyint NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`alpha_exclude_id`),
  KEY `publication_id` (`publication_id`),
  KEY `exclude_date` (`exclude_date`)
) ENGINE=InnoDB AUTO_INCREMENT=1627 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `assumptions`
--

DROP TABLE IF EXISTS `assumptions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `assumptions` (
  `assumptions_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `publication_date` date NOT NULL,
  `increased_demand` mediumint NOT NULL DEFAULT '0',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`assumptions_id`),
  KEY `publication_id` (`publication_id`,`publication_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ats_sales_filter`
--

DROP TABLE IF EXISTS `ats_sales_filter`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ats_sales_filter` (
  `ats_sales_filter_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `filter_date` date NOT NULL,
  `name` varchar(64) NOT NULL DEFAULT '',
  `description` text NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`ats_sales_filter_id`),
  KEY `filter_date` (`filter_date`)
) ENGINE=InnoDB AUTO_INCREMENT=10030 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `calculation_specification`
--

DROP TABLE IF EXISTS `calculation_specification`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `calculation_specification` (
  `calculation_specification_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `outlet_id` int unsigned NOT NULL,
  `calculation_date` date NOT NULL,
  `max_return_percentage` tinyint unsigned NOT NULL DEFAULT '0',
  `extra_delivery_percentage` tinyint unsigned NOT NULL DEFAULT '0',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`calculation_specification_id`),
  KEY `publication_id` (`publication_id`,`calculation_date`),
  KEY `outlet_id` (`outlet_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `cassandra_log`
--

DROP TABLE IF EXISTS `cassandra_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cassandra_log` (
  `cassandra_log_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `type` tinyint NOT NULL,
  `log_date` date NOT NULL,
  `user_id` int unsigned NOT NULL,
  `user_role` tinyint unsigned NOT NULL,
  `locked` tinyint(1) NOT NULL,
  `message` text NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`cassandra_log_id`),
  KEY `publication_id` (`publication_id`,`type`)
) ENGINE=InnoDB AUTO_INCREMENT=156 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `cassandra_log_tag`
--

DROP TABLE IF EXISTS `cassandra_log_tag`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cassandra_log_tag` (
  `cassandra_log__tag_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `cassandra_log_id` int unsigned NOT NULL,
  `tag` varchar(32) NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`cassandra_log__tag_id`),
  KEY `publication_id` (`publication_id`),
  KEY `cassandra_log_id` (`cassandra_log_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `city`
--

DROP TABLE IF EXISTS `city`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `city` (
  `city_id` int unsigned NOT NULL AUTO_INCREMENT,
  `country_id` smallint unsigned NOT NULL,
  `geoname_id` int unsigned NOT NULL DEFAULT '0',
  `city_name` varchar(64) NOT NULL DEFAULT '',
  `local_city_name` varchar(255) NOT NULL DEFAULT '',
  `alternative_names` varchar(2048) NOT NULL DEFAULT '',
  `population` int NOT NULL DEFAULT '0',
  `city_locode` char(3) NOT NULL DEFAULT '',
  `longitude` char(9) NOT NULL DEFAULT '',
  `latitude` char(9) NOT NULL DEFAULT '',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT '0000-00-00 00:00:00',
  PRIMARY KEY (`city_id`),
  UNIQUE KEY `city_name` (`city_name`)
) ENGINE=InnoDB AUTO_INCREMENT=21672 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `configuration`
--

DROP TABLE IF EXISTS `configuration`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `configuration` (
  `configuration_id` smallint unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `publication_type` tinyint NOT NULL DEFAULT '0',
  `peak_period` tinyint(1) NOT NULL DEFAULT '0',
  `minimum_delivery_per_outlet` smallint NOT NULL DEFAULT '0',
  `cost_per_unit` float NOT NULL DEFAULT '0',
  `profit_per_unit` float NOT NULL DEFAULT '0',
  `alpha` smallint NOT NULL DEFAULT '30',
  `beta` smallint NOT NULL DEFAULT '20',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `pad_days` smallint NOT NULL DEFAULT '720',
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `sales_data_days` smallint NOT NULL DEFAULT '720',
  `alpha_observations` smallint NOT NULL DEFAULT '365',
  `residual_sale_minimum` smallint NOT NULL DEFAULT '-10000',
  `sold_out_three_prediction` smallint NOT NULL DEFAULT '0',
  `sold_out_three_draw_prediction` smallint NOT NULL DEFAULT '0',
  `sold_out_three_standard_deviation` smallint NOT NULL DEFAULT '0',
  `sold_out_four_prediction` smallint NOT NULL DEFAULT '0',
  `sold_out_four_draw_prediction` smallint NOT NULL DEFAULT '0',
  `sold_out_four_standard_deviation` smallint NOT NULL DEFAULT '0',
  `large_weekday` tinyint NOT NULL DEFAULT '6',
  `shrinkage` tinyint(1) NOT NULL DEFAULT '0',
  `sigma_sold_out_increase` int DEFAULT '1',
  `use_sales_filter` tinyint(1) NOT NULL DEFAULT '1',
  `pad_days_min` smallint NOT NULL DEFAULT '365',
  `min_shrikage_ratio` float NOT NULL DEFAULT '0.15',
  `max_shrikage_ratio` float NOT NULL DEFAULT '1.1',
  `maximum_return_percentage_tier_1` float NOT NULL DEFAULT '0',
  `maximum_return_percentage_tier_2` float NOT NULL DEFAULT '0',
  `maximum_return_percentage_tier_3` float NOT NULL DEFAULT '0',
  `max_ret_pct_draw_tier_1` smallint NOT NULL DEFAULT '0',
  `max_ret_pct_draw_tier_2` smallint NOT NULL DEFAULT '0',
  `max_ret_pct_draw_tier_3` smallint NOT NULL DEFAULT '0',
  `maximum_return_percentage_tier_4` float NOT NULL DEFAULT '0',
  `max_ret_pct_draw_tier_4` smallint NOT NULL DEFAULT '0',
  `prediction_observations` tinyint NOT NULL DEFAULT '4',
  `min_theta_observations` smallint NOT NULL DEFAULT '12',
  `panic_max_prediction` smallint NOT NULL DEFAULT '1000',
  `prediction_method` tinyint NOT NULL DEFAULT '1',
  `autodetect_shrinkage` tinyint(1) NOT NULL DEFAULT '1',
  `min_post_shrinkage_profit` float NOT NULL DEFAULT '0',
  `shrinkage_delay` smallint NOT NULL DEFAULT '0',
  `shrinkage_duration` smallint NOT NULL DEFAULT '8',
  `draw_floor_draw_tier_1` smallint NOT NULL DEFAULT '0',
  `draw_floor_sale_tier_1` float NOT NULL DEFAULT '0',
  `draw_floor_adjustment_tier_1` smallint NOT NULL DEFAULT '0',
  `draw_floor_draw_tier_2` smallint NOT NULL DEFAULT '0',
  `draw_floor_sale_tier_2` float NOT NULL DEFAULT '0',
  `draw_floor_adjustment_tier_2` smallint NOT NULL DEFAULT '0',
  `draw_floor_draw_tier_3` smallint NOT NULL DEFAULT '0',
  `draw_floor_sale_tier_3` float NOT NULL DEFAULT '0',
  `draw_floor_adjustment_tier_3` smallint NOT NULL DEFAULT '0',
  `draw_floor_draw_tier_4` smallint NOT NULL DEFAULT '0',
  `draw_floor_sale_tier_4` float NOT NULL DEFAULT '0',
  `draw_floor_adjustment_tier_4` smallint NOT NULL DEFAULT '0',
  `pad_method` tinyint NOT NULL DEFAULT '1',
  `pad_method_2` tinyint NOT NULL DEFAULT '1',
  `scan_prediction` tinyint NOT NULL DEFAULT '0',
  PRIMARY KEY (`configuration_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB AUTO_INCREMENT=127 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `configuration_issues_per_year`
--

DROP TABLE IF EXISTS `configuration_issues_per_year`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `configuration_issues_per_year` (
  `configuration_issues_per_year_id` smallint unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `day_of_week` tinyint unsigned NOT NULL DEFAULT '0',
  `issues_per_year` smallint unsigned NOT NULL DEFAULT '0',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`configuration_issues_per_year_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB AUTO_INCREMENT=960 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `console_task`
--

DROP TABLE IF EXISTS `console_task`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `console_task` (
  `console_task_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL DEFAULT '0',
  `user_id` int unsigned NOT NULL DEFAULT '0',
  `task_type` smallint unsigned NOT NULL DEFAULT '0',
  `name` varchar(64) NOT NULL DEFAULT '',
  `needle` varchar(64) NOT NULL DEFAULT '',
  `mark` varchar(16) NOT NULL DEFAULT '',
  `progress` smallint NOT NULL DEFAULT '0',
  `progress_total` smallint NOT NULL DEFAULT '0',
  `finished` tinyint(1) DEFAULT '0',
  `finished_date` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `status` tinyint NOT NULL DEFAULT '1',
  `checked` tinyint(1) DEFAULT '0',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `method` tinyint unsigned NOT NULL DEFAULT '1',
  `timeout` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`console_task_id`)
) ENGINE=InnoDB AUTO_INCREMENT=63805 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `cookie`
--

DROP TABLE IF EXISTS `cookie`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cookie` (
  `cookie_id` int unsigned NOT NULL AUTO_INCREMENT,
  `cookie` int unsigned NOT NULL,
  `user_id` int unsigned NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`cookie_id`),
  KEY `cookie` (`cookie`),
  KEY `user_id` (`user_id`)
) ENGINE=InnoDB AUTO_INCREMENT=7835 DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `county`
--

DROP TABLE IF EXISTS `county`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `county` (
  `county_id` int unsigned NOT NULL AUTO_INCREMENT,
  `country_id` smallint unsigned NOT NULL,
  `county_name` varchar(255) NOT NULL DEFAULT '',
  `county_external_id` int unsigned NOT NULL DEFAULT '0',
  `longitude` char(9) NOT NULL DEFAULT '',
  `latitude` char(9) NOT NULL DEFAULT '',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT '0000-00-00 00:00:00',
  PRIMARY KEY (`county_id`),
  UNIQUE KEY `county_name` (`county_name`),
  KEY `county_external_id` (`county_external_id`)
) ENGINE=InnoDB AUTO_INCREMENT=21 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `currency`
--

DROP TABLE IF EXISTS `currency`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `currency` (
  `currency_id` smallint unsigned NOT NULL AUTO_INCREMENT,
  `currency_name` varchar(64) NOT NULL DEFAULT '',
  `currency_code` char(3) NOT NULL DEFAULT '',
  `currency_sign` char(3) NOT NULL DEFAULT '',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT '0000-00-00 00:00:00',
  PRIMARY KEY (`currency_id`),
  UNIQUE KEY `currency_name` (`currency_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `customer`
--

DROP TABLE IF EXISTS `customer`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `customer` (
  `customer_id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL DEFAULT '',
  `description` text NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT '0000-00-00 00:00:00',
  PRIMARY KEY (`customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `draw_adjustment`
--

DROP TABLE IF EXISTS `draw_adjustment`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `draw_adjustment` (
  `draw_adjustment_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `outlet_class_id` int unsigned NOT NULL DEFAULT '0',
  `name` varchar(64) NOT NULL DEFAULT '',
  `date_start` date NOT NULL,
  `date_end` date NOT NULL,
  `day_of_week` tinyint NOT NULL DEFAULT '0',
  `event_type` tinyint NOT NULL DEFAULT '0',
  `adjustment_value` smallint NOT NULL DEFAULT '0',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `pseudo_class` tinyint unsigned NOT NULL DEFAULT '0',
  `pseudo_class_value` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`draw_adjustment_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB AUTO_INCREMENT=2177 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `draw_export_configuration`
--

DROP TABLE IF EXISTS `draw_export_configuration`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `draw_export_configuration` (
  `draw_export_configuration_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `template_index` tinyint unsigned NOT NULL DEFAULT '0',
  `name` varchar(256) NOT NULL DEFAULT '',
  `description` text NOT NULL,
  `header` tinyint(1) DEFAULT '0',
  `variable_length` tinyint(1) DEFAULT '1',
  `field_separator` varchar(16) NOT NULL DEFAULT '',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `readonly` tinyint(1) DEFAULT '0',
  `filename` varchar(256) NOT NULL DEFAULT '',
  `character_set` tinyint NOT NULL DEFAULT '1',
  `download` tinyint(1) NOT NULL DEFAULT '1',
  `ftp` tinyint(1) NOT NULL DEFAULT '0',
  `mail` tinyint(1) NOT NULL DEFAULT '0',
  `sum_file` tinyint(1) NOT NULL DEFAULT '0',
  `sum_filename` varchar(64) NOT NULL DEFAULT '',
  `footer` tinyint(1) DEFAULT '0',
  `footer_text` text NOT NULL,
  PRIMARY KEY (`draw_export_configuration_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB AUTO_INCREMENT=98 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `draw_export_element`
--

DROP TABLE IF EXISTS `draw_export_element`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `draw_export_element` (
  `draw_export_element_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `draw_export_configuration_id` int unsigned NOT NULL,
  `element_index` tinyint unsigned NOT NULL DEFAULT '0',
  `element_type` tinyint unsigned NOT NULL DEFAULT '0',
  `element` mediumint unsigned NOT NULL DEFAULT '0',
  `fixed_length` tinyint unsigned NOT NULL DEFAULT '0',
  `prepend_fillers` tinyint(1) DEFAULT '1',
  `filler_char` varchar(1) NOT NULL DEFAULT ' ',
  `date_format` varchar(16) NOT NULL DEFAULT 'MM/DD/YYYY',
  `fixed_text` varchar(256) NOT NULL DEFAULT '',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `header_name` varchar(64) NOT NULL DEFAULT 'Unnamed',
  `date_shift` tinyint NOT NULL DEFAULT '0',
  `placement` tinyint unsigned NOT NULL DEFAULT '1',
  `draw_filler_char` varchar(1) NOT NULL DEFAULT ' ',
  `prepend_text` varchar(256) NOT NULL DEFAULT '',
  `append_text` varchar(256) NOT NULL DEFAULT '',
  `date_weekday` tinyint NOT NULL DEFAULT '100',
  PRIMARY KEY (`draw_export_element_id`),
  KEY `publication_id` (`publication_id`),
  KEY `draw_export_configuration_id` (`draw_export_configuration_id`)
) ENGINE=InnoDB AUTO_INCREMENT=789 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `draw_file_fields`
--

DROP TABLE IF EXISTS `draw_file_fields`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `draw_file_fields` (
  `draw_file_fields_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `sort_order` tinyint NOT NULL,
  `type` tinyint NOT NULL,
  `value` varchar(64) NOT NULL DEFAULT '',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`draw_file_fields_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB AUTO_INCREMENT=17 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `draw_log`
--

DROP TABLE IF EXISTS `draw_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `draw_log` (
  `draw_log_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `draw_date` date NOT NULL,
  `strategy_calculation_id` int unsigned NOT NULL,
  `comments` text NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`draw_log_id`),
  KEY `publication_id` (`publication_id`),
  KEY `draw_date` (`draw_date`)
) ENGINE=InnoDB AUTO_INCREMENT=304918 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `email_template`
--

DROP TABLE IF EXISTS `email_template`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `email_template` (
  `email_template_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `name` varchar(64) NOT NULL DEFAULT '',
  `title` varchar(64) NOT NULL DEFAULT '',
  `message` text NOT NULL,
  `parameter_1` varchar(64) NOT NULL DEFAULT '',
  `parameter_2` varchar(64) NOT NULL DEFAULT '',
  `parameter_3` varchar(64) NOT NULL DEFAULT '',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`email_template_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `export_configuration`
--

DROP TABLE IF EXISTS `export_configuration`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `export_configuration` (
  `export_configuration_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `template_index` tinyint unsigned NOT NULL DEFAULT '0',
  `filename` varchar(64) NOT NULL DEFAULT '',
  `name` varchar(256) NOT NULL DEFAULT '',
  `description` text NOT NULL,
  `export_group` int unsigned NOT NULL DEFAULT '0',
  `header` tinyint(1) DEFAULT '0',
  `field_separator` varchar(16) NOT NULL DEFAULT '',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`export_configuration_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB AUTO_INCREMENT=46 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `export_element`
--

DROP TABLE IF EXISTS `export_element`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `export_element` (
  `export_element_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `export_configuration_id` int unsigned NOT NULL,
  `include` tinyint(1) NOT NULL DEFAULT '1',
  `header_name` varchar(64) NOT NULL DEFAULT 'Unnamed',
  `element_index` tinyint unsigned NOT NULL DEFAULT '0',
  `element_type` tinyint unsigned NOT NULL DEFAULT '0',
  `element` mediumint unsigned NOT NULL DEFAULT '0',
  `decimal_seperator` varchar(4) NOT NULL DEFAULT '.',
  `date_format` varchar(16) NOT NULL DEFAULT 'MM/DD/YYYY',
  `allow` text NOT NULL,
  `disallow` text NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`export_element_id`),
  KEY `publication_id` (`publication_id`),
  KEY `export_configuration_id` (`export_configuration_id`)
) ENGINE=InnoDB AUTO_INCREMENT=269 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `frontend_update`
--

DROP TABLE IF EXISTS `frontend_update`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `frontend_update` (
  `frontend_update_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL DEFAULT '0',
  `area` tinyint NOT NULL DEFAULT '1',
  `update_date` date NOT NULL DEFAULT '2010-01-01',
  `update_time` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_message` text NOT NULL,
  `update_type` tinyint NOT NULL DEFAULT '0',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`frontend_update_id`),
  KEY `publication_id` (`publication_id`),
  KEY `area` (`area`),
  KEY `update_date` (`update_date`)
) ENGINE=InnoDB AUTO_INCREMENT=193501 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `gamma`
--

DROP TABLE IF EXISTS `gamma`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `gamma` (
  `gamma_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `outlet_id` int unsigned NOT NULL,
  `day_of_week` tinyint NOT NULL,
  `peak_period_group_id` int unsigned NOT NULL,
  `gamma` decimal(12,6) NOT NULL DEFAULT '0.000000',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT '0000-00-00 00:00:00',
  `gamma_average` decimal(12,6) NOT NULL DEFAULT '0.000000',
  `gamma_mul` decimal(12,6) NOT NULL DEFAULT '1.000000',
  `gamma_average_mul` decimal(12,6) NOT NULL DEFAULT '1.000000',
  PRIMARY KEY (`gamma_id`),
  KEY `publication_id` (`publication_id`),
  KEY `outlet_id` (`outlet_id`)
) ENGINE=InnoDB AUTO_INCREMENT=133280026 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `generic_peak_period`
--

DROP TABLE IF EXISTS `generic_peak_period`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `generic_peak_period` (
  `generic_peak_period_id` int unsigned NOT NULL AUTO_INCREMENT,
  `country_name` varchar(64) NOT NULL,
  `us_state_name` varchar(64) NOT NULL,
  `peak_period_group_id` int unsigned NOT NULL,
  `date_start` date NOT NULL,
  `date_end` date NOT NULL,
  `day_of_week` tinyint NOT NULL,
  `type` tinyint unsigned NOT NULL,
  `variation_reduction` tinyint unsigned NOT NULL DEFAULT '100',
  `booster_pad` mediumint NOT NULL DEFAULT '100',
  `booster_std` mediumint NOT NULL DEFAULT '100',
  `allow_negative` tinyint(1) NOT NULL DEFAULT '0',
  `outlet_class_id` int unsigned NOT NULL DEFAULT '0',
  `historic_days` smallint unsigned NOT NULL DEFAULT '1095',
  `comment` text NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `publish` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`generic_peak_period_id`)
) ENGINE=InnoDB AUTO_INCREMENT=1233 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `import_configuration`
--

DROP TABLE IF EXISTS `import_configuration`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `import_configuration` (
  `import_configuration_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `template_index` tinyint unsigned NOT NULL DEFAULT '0',
  `import_type` tinyint unsigned NOT NULL DEFAULT '1',
  `active_template` tinyint(1) DEFAULT '0',
  `description` text NOT NULL,
  `header` tinyint(1) DEFAULT '0',
  `field_separator` varchar(16) NOT NULL DEFAULT '',
  `date_format` varchar(16) NOT NULL DEFAULT '',
  `negative_return` tinyint(1) DEFAULT '0',
  `import_line` varchar(255) NOT NULL DEFAULT '',
  `rule_1` tinyint NOT NULL DEFAULT '1',
  `rule_2` tinyint NOT NULL DEFAULT '1',
  `rule_3` tinyint NOT NULL DEFAULT '1',
  `rule_4` tinyint NOT NULL DEFAULT '1',
  `rule_5` tinyint NOT NULL DEFAULT '1',
  `rule_6` tinyint NOT NULL DEFAULT '1',
  `rule_7` tinyint NOT NULL DEFAULT '1',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `draw_adjustment_add_subtract` tinyint(1) DEFAULT '0',
  `post_import_query` text NOT NULL,
  `name` varchar(256) NOT NULL DEFAULT '',
  `import_element_rules` varchar(4096) NOT NULL DEFAULT '',
  `readonly` tinyint(1) DEFAULT '0',
  `character_set` tinyint NOT NULL DEFAULT '1',
  `reset_production_group` tinyint(1) DEFAULT '0',
  `add_production_group` tinyint(1) DEFAULT '0',
  `footer` tinyint(1) DEFAULT '0',
  `footer_lines` mediumint unsigned NOT NULL DEFAULT '1',
  `header_lines` mediumint unsigned NOT NULL DEFAULT '1',
  `incomplete_sales_data_close` tinyint(1) DEFAULT '0',
  `incomplete_sales_data` tinyint(1) DEFAULT '0',
  `move_to_store` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`import_configuration_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB AUTO_INCREMENT=321 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `import_element`
--

DROP TABLE IF EXISTS `import_element`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `import_element` (
  `import_element_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `import_configuration_id` int unsigned NOT NULL,
  `element_index` tinyint unsigned NOT NULL DEFAULT '0',
  `element_type` tinyint unsigned NOT NULL DEFAULT '0',
  `element` mediumint unsigned NOT NULL DEFAULT '0',
  `allow_empty` tinyint(1) DEFAULT '1',
  `allow_negative` tinyint(1) DEFAULT '1',
  `allow_positive` tinyint(1) DEFAULT '1',
  `add_draw` tinyint(1) DEFAULT '1',
  `format_type` tinyint unsigned NOT NULL DEFAULT '1',
  `decimal_seperator` varchar(4) NOT NULL DEFAULT '.',
  `date_format` varchar(16) NOT NULL DEFAULT 'MM/DD/YYYY',
  `weekday_start_sunday` tinyint(1) DEFAULT '1',
  `weekday_start_one` tinyint(1) DEFAULT '1',
  `allow` text NOT NULL,
  `disallow` text NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `allow_zero` tinyint(1) DEFAULT '1',
  `strip` varchar(16) NOT NULL DEFAULT '',
  `shift_days` tinyint NOT NULL DEFAULT '0',
  `translate_1` varchar(16) NOT NULL DEFAULT '',
  `translate_2` varchar(16) NOT NULL DEFAULT '',
  `translate_3` varchar(16) NOT NULL DEFAULT '',
  `translate_to_1` varchar(16) NOT NULL DEFAULT '',
  `translate_to_2` varchar(16) NOT NULL DEFAULT '',
  `translate_to_3` varchar(16) NOT NULL DEFAULT '',
  `working_account` tinyint(1) DEFAULT '1',
  `negative_parenthesis` tinyint(1) DEFAULT '1',
  `maximum_value` mediumint unsigned NOT NULL DEFAULT '250',
  `empty_is_zero` tinyint(1) DEFAULT '0',
  `adjust_by_fixed_amount` float NOT NULL DEFAULT '0',
  `sequence_separator` varchar(4) NOT NULL DEFAULT ',',
  `shrinkage_day_of_week` tinyint NOT NULL DEFAULT '0',
  PRIMARY KEY (`import_element_id`),
  KEY `publication_id` (`publication_id`),
  KEY `import_configuration_id` (`import_configuration_id`)
) ENGINE=InnoDB AUTO_INCREMENT=3941 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `import_log`
--

DROP TABLE IF EXISTS `import_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `import_log` (
  `import_log_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `mark` varchar(64) NOT NULL DEFAULT '',
  `ajax_id` varchar(16) NOT NULL DEFAULT '',
  `verification` tinyint(1) DEFAULT '0',
  `file` varchar(64) NOT NULL,
  `lines_total` int NOT NULL DEFAULT '0',
  `lines_parsed` int NOT NULL DEFAULT '0',
  `lines_skipped` int NOT NULL DEFAULT '0',
  `lines_error` int NOT NULL DEFAULT '0',
  `progress` smallint NOT NULL DEFAULT '0',
  `error` tinyint(1) DEFAULT '0',
  `error_code` smallint NOT NULL DEFAULT '0',
  `error_message` varchar(64) NOT NULL DEFAULT '',
  `execution_info` varchar(64) NOT NULL DEFAULT '',
  `results` text NOT NULL,
  `running` tinyint(1) DEFAULT '0',
  `finished` tinyint(1) DEFAULT '0',
  `started_time` timestamp NOT NULL DEFAULT '2010-01-01 00:00:00',
  `finished_time` timestamp NOT NULL DEFAULT '2010-01-01 00:00:00',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `turk_action_historic_id` int unsigned NOT NULL DEFAULT '0',
  `status` tinyint NOT NULL DEFAULT '1',
  PRIMARY KEY (`import_log_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB AUTO_INCREMENT=17246 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `import_post_processing`
--

DROP TABLE IF EXISTS `import_post_processing`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `import_post_processing` (
  `import_post_processing_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `import_configuration_id` int unsigned NOT NULL,
  `name` varchar(256) NOT NULL DEFAULT '',
  `description` text NOT NULL,
  `action` tinyint DEFAULT '1',
  `data_source` tinyint DEFAULT '1',
  `outlet_list` text NOT NULL,
  `date_list` text NOT NULL,
  `date_from` varchar(16) NOT NULL DEFAULT '2000.01.02',
  `date_to` varchar(16) NOT NULL DEFAULT '2000.01.01',
  `earlier_than` tinyint DEFAULT '0',
  `outlet_attribute` varchar(32) NOT NULL DEFAULT '',
  `attribute_constraint` varchar(2048) NOT NULL DEFAULT '',
  `constraint_comparison` tinyint DEFAULT '1',
  `manual_sql` text NOT NULL,
  `auto_sql` text NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ext_list` text NOT NULL,
  `in_out` tinyint(1) DEFAULT '1',
  PRIMARY KEY (`import_post_processing_id`),
  KEY `publication_id` (`publication_id`),
  KEY `import_configuration_id` (`import_configuration_id`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `import_processed`
--

DROP TABLE IF EXISTS `import_processed`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `import_processed` (
  `import_processed_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `filename` varchar(255) NOT NULL DEFAULT '',
  `processed_count` mediumint unsigned NOT NULL DEFAULT '1',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`import_processed_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB AUTO_INCREMENT=42762 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `issue_to_date`
--

DROP TABLE IF EXISTS `issue_to_date`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `issue_to_date` (
  `issue_to_date_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `issue_number` int unsigned NOT NULL,
  `publication_date` date NOT NULL,
  `season_code` varchar(255) NOT NULL DEFAULT '',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`issue_to_date_id`),
  KEY `publication_id` (`publication_id`,`issue_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `language`
--

DROP TABLE IF EXISTS `language`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `language` (
  `language_id` smallint unsigned NOT NULL AUTO_INCREMENT,
  `language_name` varchar(64) NOT NULL DEFAULT '',
  `language_name_french` varchar(64) NOT NULL DEFAULT '',
  `language_name_native` varchar(64) NOT NULL DEFAULT '',
  `language_code_2` char(2) NOT NULL DEFAULT '',
  `language_code_3` char(3) NOT NULL DEFAULT '',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT '0000-00-00 00:00:00',
  PRIMARY KEY (`language_id`),
  KEY `language_name` (`language_name`)
) ENGINE=InnoDB AUTO_INCREMENT=506 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `municipality`
--

DROP TABLE IF EXISTS `municipality`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `municipality` (
  `municipality_id` int unsigned NOT NULL AUTO_INCREMENT,
  `country_id` smallint unsigned NOT NULL,
  `municipality_name` varchar(255) NOT NULL DEFAULT '',
  `municipality_external_id` int unsigned NOT NULL DEFAULT '0',
  `longitude` char(9) NOT NULL DEFAULT '',
  `latitude` char(9) NOT NULL DEFAULT '',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT '0000-00-00 00:00:00',
  PRIMARY KEY (`municipality_id`),
  UNIQUE KEY `municipality_name` (`municipality_name`),
  KEY `municipality_external_id` (`municipality_external_id`)
) ENGINE=InnoDB AUTO_INCREMENT=434 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `outlet`
--

DROP TABLE IF EXISTS `outlet`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `outlet` (
  `outlet_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `id` int NOT NULL DEFAULT '0',
  `ext_id_1` varchar(32) NOT NULL DEFAULT '0',
  `peak_period` tinyint(1) NOT NULL DEFAULT '0',
  `sublets` mediumint NOT NULL DEFAULT '0',
  `outlet_name` varchar(64) NOT NULL DEFAULT '',
  `description` text NOT NULL,
  `phone_number` varchar(32) NOT NULL DEFAULT '',
  `street_and_number` varchar(64) NOT NULL DEFAULT '',
  `city_name` varchar(64) NOT NULL DEFAULT '',
  `city_code` varchar(64) NOT NULL DEFAULT '',
  `us_state_name` varchar(64) NOT NULL DEFAULT '',
  `zip_name` varchar(64) NOT NULL DEFAULT '',
  `zip_id` int NOT NULL DEFAULT '0',
  `county_id` varchar(64) NOT NULL DEFAULT '',
  `municipality_id` int NOT NULL DEFAULT '0',
  `district` varchar(128) NOT NULL DEFAULT '',
  `sub_district` varchar(64) NOT NULL DEFAULT '',
  `country_id` smallint NOT NULL DEFAULT '0',
  `longitude` char(9) NOT NULL DEFAULT '',
  `latitude` char(9) NOT NULL DEFAULT '',
  `publication` varchar(64) NOT NULL DEFAULT '',
  `carrier` varchar(64) NOT NULL DEFAULT '',
  `branch` varchar(64) NOT NULL DEFAULT '',
  `product` varchar(64) NOT NULL DEFAULT '',
  `truck` varchar(64) NOT NULL DEFAULT '',
  `sc_type` varchar(64) NOT NULL DEFAULT '',
  `tariff_model` tinyint NOT NULL DEFAULT '0',
  `outlet_type` varchar(64) DEFAULT NULL,
  `outlet_type_2` varchar(64) NOT NULL DEFAULT '',
  `zone_id_text` varchar(64) NOT NULL DEFAULT '',
  `rate_class_id` varchar(64) NOT NULL DEFAULT '',
  `pay_type` varchar(64) NOT NULL DEFAULT '',
  `chain_id` varchar(64) NOT NULL DEFAULT '',
  `area` varchar(32) NOT NULL DEFAULT '',
  `dc` varchar(32) NOT NULL DEFAULT '',
  `auto_generated` tinyint(1) NOT NULL DEFAULT '0',
  `start_date` date NOT NULL DEFAULT '1900-01-01',
  `draw_monday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_tuesday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_wednesday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_thursday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_friday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_saturday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_sunday` tinyint(1) NOT NULL DEFAULT '1',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `delayed_return` smallint unsigned NOT NULL DEFAULT '0',
  `end_date` date NOT NULL DEFAULT '1900-01-01',
  `allow_draw_changes` tinyint(1) NOT NULL DEFAULT '0',
  `drop_location` varchar(64) NOT NULL DEFAULT '',
  `sub_truck` varchar(64) NOT NULL DEFAULT '',
  `custom_1` varchar(256) NOT NULL DEFAULT '',
  `custom_2` varchar(256) NOT NULL DEFAULT '',
  `custom_3` varchar(256) NOT NULL DEFAULT '',
  `custom_4` varchar(256) NOT NULL DEFAULT '',
  `custom_5` varchar(256) NOT NULL DEFAULT '',
  `notes` text NOT NULL,
  `instructions` text NOT NULL,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `zone_id` varchar(64) NOT NULL DEFAULT '',
  `scan_account` tinyint(1) NOT NULL DEFAULT '1',
  `use_scan_sales` tinyint(1) NOT NULL DEFAULT '0',
  `scan_prediction` tinyint NOT NULL DEFAULT '0',
  PRIMARY KEY (`outlet_id`),
  KEY `outlet_name` (`outlet_name`),
  KEY `ext_id_1` (`ext_id_1`),
  KEY `active` (`active`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB AUTO_INCREMENT=507498 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `outlet_2025`
--

DROP TABLE IF EXISTS `outlet_2025`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `outlet_2025` (
  `outlet_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `id` int NOT NULL DEFAULT '0',
  `ext_id_1` varchar(32) NOT NULL DEFAULT '0',
  `peak_period` tinyint(1) NOT NULL DEFAULT '0',
  `sublets` mediumint NOT NULL DEFAULT '0',
  `outlet_name` varchar(64) NOT NULL DEFAULT '',
  `description` text NOT NULL,
  `phone_number` varchar(32) NOT NULL DEFAULT '',
  `street_and_number` varchar(64) NOT NULL DEFAULT '',
  `city_name` varchar(64) NOT NULL DEFAULT '',
  `city_code` varchar(64) NOT NULL DEFAULT '',
  `us_state_name` varchar(64) NOT NULL DEFAULT '',
  `zip_name` varchar(64) NOT NULL DEFAULT '',
  `zip_id` int NOT NULL DEFAULT '0',
  `county_id` varchar(64) NOT NULL DEFAULT '',
  `municipality_id` int NOT NULL DEFAULT '0',
  `district` varchar(128) NOT NULL DEFAULT '',
  `sub_district` varchar(64) NOT NULL DEFAULT '',
  `country_id` smallint NOT NULL DEFAULT '0',
  `longitude` char(9) NOT NULL DEFAULT '',
  `latitude` char(9) NOT NULL DEFAULT '',
  `publication` varchar(64) NOT NULL DEFAULT '',
  `carrier` varchar(64) NOT NULL DEFAULT '',
  `branch` varchar(64) NOT NULL DEFAULT '',
  `product` varchar(64) NOT NULL DEFAULT '',
  `truck` varchar(64) NOT NULL DEFAULT '',
  `sc_type` varchar(64) NOT NULL DEFAULT '',
  `tariff_model` tinyint NOT NULL DEFAULT '0',
  `outlet_type` varchar(64) DEFAULT NULL,
  `outlet_type_2` varchar(64) NOT NULL DEFAULT '',
  `zone_id_text` varchar(64) NOT NULL DEFAULT '',
  `rate_class_id` varchar(64) NOT NULL DEFAULT '',
  `pay_type` varchar(64) NOT NULL DEFAULT '',
  `chain_id` varchar(64) NOT NULL DEFAULT '',
  `area` varchar(32) NOT NULL DEFAULT '',
  `dc` varchar(32) NOT NULL DEFAULT '',
  `auto_generated` tinyint(1) NOT NULL DEFAULT '0',
  `start_date` date NOT NULL DEFAULT '1900-01-01',
  `draw_monday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_tuesday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_wednesday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_thursday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_friday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_saturday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_sunday` tinyint(1) NOT NULL DEFAULT '1',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `delayed_return` smallint unsigned NOT NULL DEFAULT '0',
  `end_date` date NOT NULL DEFAULT '1900-01-01',
  `allow_draw_changes` tinyint(1) NOT NULL DEFAULT '0',
  `drop_location` varchar(64) NOT NULL DEFAULT '',
  `sub_truck` varchar(64) NOT NULL DEFAULT '',
  `custom_1` varchar(256) NOT NULL DEFAULT '',
  `custom_2` varchar(256) NOT NULL DEFAULT '',
  `custom_3` varchar(256) NOT NULL DEFAULT '',
  `custom_4` varchar(256) NOT NULL DEFAULT '',
  `custom_5` varchar(256) NOT NULL DEFAULT '',
  `notes` text NOT NULL,
  `instructions` text NOT NULL,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `zone_id` varchar(64) NOT NULL DEFAULT '',
  `scan_account` tinyint(1) NOT NULL DEFAULT '1',
  `use_scan_sales` tinyint(1) NOT NULL DEFAULT '0',
  `scan_prediction` tinyint NOT NULL DEFAULT '0',
  PRIMARY KEY (`outlet_id`),
  KEY `outlet_name` (`outlet_name`),
  KEY `ext_id_1` (`ext_id_1`),
  KEY `active` (`active`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB AUTO_INCREMENT=507092 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `outlet_2025_01_03`
--

DROP TABLE IF EXISTS `outlet_2025_01_03`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `outlet_2025_01_03` (
  `outlet_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `id` int NOT NULL DEFAULT '0',
  `ext_id_1` varchar(32) NOT NULL DEFAULT '0',
  `peak_period` tinyint(1) NOT NULL DEFAULT '0',
  `sublets` mediumint NOT NULL DEFAULT '0',
  `outlet_name` varchar(64) NOT NULL DEFAULT '',
  `description` text NOT NULL,
  `phone_number` varchar(32) NOT NULL DEFAULT '',
  `street_and_number` varchar(64) NOT NULL DEFAULT '',
  `city_name` varchar(64) NOT NULL DEFAULT '',
  `city_code` varchar(64) NOT NULL DEFAULT '',
  `us_state_name` varchar(64) NOT NULL DEFAULT '',
  `zip_name` varchar(64) NOT NULL DEFAULT '',
  `zip_id` int NOT NULL DEFAULT '0',
  `county_id` varchar(64) NOT NULL DEFAULT '',
  `municipality_id` int NOT NULL DEFAULT '0',
  `district` varchar(128) NOT NULL DEFAULT '',
  `sub_district` varchar(64) NOT NULL DEFAULT '',
  `country_id` smallint NOT NULL DEFAULT '0',
  `longitude` char(9) NOT NULL DEFAULT '',
  `latitude` char(9) NOT NULL DEFAULT '',
  `publication` varchar(64) NOT NULL DEFAULT '',
  `carrier` varchar(64) NOT NULL DEFAULT '',
  `branch` varchar(64) NOT NULL DEFAULT '',
  `product` varchar(64) NOT NULL DEFAULT '',
  `truck` varchar(64) NOT NULL DEFAULT '',
  `sc_type` varchar(64) NOT NULL DEFAULT '',
  `tariff_model` tinyint NOT NULL DEFAULT '0',
  `outlet_type` varchar(64) DEFAULT NULL,
  `outlet_type_2` varchar(64) NOT NULL DEFAULT '',
  `zone_id_text` varchar(64) NOT NULL DEFAULT '',
  `rate_class_id` varchar(64) NOT NULL DEFAULT '',
  `pay_type` varchar(64) NOT NULL DEFAULT '',
  `chain_id` varchar(64) NOT NULL DEFAULT '',
  `area` varchar(32) NOT NULL DEFAULT '',
  `dc` varchar(32) NOT NULL DEFAULT '',
  `auto_generated` tinyint(1) NOT NULL DEFAULT '0',
  `start_date` date NOT NULL DEFAULT '1900-01-01',
  `draw_monday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_tuesday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_wednesday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_thursday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_friday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_saturday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_sunday` tinyint(1) NOT NULL DEFAULT '1',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `delayed_return` smallint unsigned NOT NULL DEFAULT '0',
  `end_date` date NOT NULL DEFAULT '1900-01-01',
  `allow_draw_changes` tinyint(1) NOT NULL DEFAULT '0',
  `drop_location` varchar(64) NOT NULL DEFAULT '',
  `sub_truck` varchar(64) NOT NULL DEFAULT '',
  `custom_1` varchar(256) NOT NULL DEFAULT '',
  `custom_2` varchar(256) NOT NULL DEFAULT '',
  `custom_3` varchar(256) NOT NULL DEFAULT '',
  `custom_4` varchar(256) NOT NULL DEFAULT '',
  `custom_5` varchar(256) NOT NULL DEFAULT '',
  `notes` text NOT NULL,
  `instructions` text NOT NULL,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `zone_id` varchar(64) NOT NULL DEFAULT '',
  `scan_account` tinyint(1) NOT NULL DEFAULT '1',
  `use_scan_sales` tinyint(1) NOT NULL DEFAULT '0',
  `scan_prediction` tinyint NOT NULL DEFAULT '0',
  PRIMARY KEY (`outlet_id`),
  KEY `outlet_name` (`outlet_name`),
  KEY `ext_id_1` (`ext_id_1`),
  KEY `active` (`active`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB AUTO_INCREMENT=506040 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `outlet_2025_01_15`
--

DROP TABLE IF EXISTS `outlet_2025_01_15`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `outlet_2025_01_15` (
  `outlet_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `id` int NOT NULL DEFAULT '0',
  `ext_id_1` varchar(32) NOT NULL DEFAULT '0',
  `peak_period` tinyint(1) NOT NULL DEFAULT '0',
  `sublets` mediumint NOT NULL DEFAULT '0',
  `outlet_name` varchar(64) NOT NULL DEFAULT '',
  `description` text NOT NULL,
  `phone_number` varchar(32) NOT NULL DEFAULT '',
  `street_and_number` varchar(64) NOT NULL DEFAULT '',
  `city_name` varchar(64) NOT NULL DEFAULT '',
  `city_code` varchar(64) NOT NULL DEFAULT '',
  `us_state_name` varchar(64) NOT NULL DEFAULT '',
  `zip_name` varchar(64) NOT NULL DEFAULT '',
  `zip_id` int NOT NULL DEFAULT '0',
  `county_id` varchar(64) NOT NULL DEFAULT '',
  `municipality_id` int NOT NULL DEFAULT '0',
  `district` varchar(128) NOT NULL DEFAULT '',
  `sub_district` varchar(64) NOT NULL DEFAULT '',
  `country_id` smallint NOT NULL DEFAULT '0',
  `longitude` char(9) NOT NULL DEFAULT '',
  `latitude` char(9) NOT NULL DEFAULT '',
  `publication` varchar(64) NOT NULL DEFAULT '',
  `carrier` varchar(64) NOT NULL DEFAULT '',
  `branch` varchar(64) NOT NULL DEFAULT '',
  `product` varchar(64) NOT NULL DEFAULT '',
  `truck` varchar(64) NOT NULL DEFAULT '',
  `sc_type` varchar(64) NOT NULL DEFAULT '',
  `tariff_model` tinyint NOT NULL DEFAULT '0',
  `outlet_type` varchar(64) DEFAULT NULL,
  `outlet_type_2` varchar(64) NOT NULL DEFAULT '',
  `zone_id_text` varchar(64) NOT NULL DEFAULT '',
  `rate_class_id` varchar(64) NOT NULL DEFAULT '',
  `pay_type` varchar(64) NOT NULL DEFAULT '',
  `chain_id` varchar(64) NOT NULL DEFAULT '',
  `area` varchar(32) NOT NULL DEFAULT '',
  `dc` varchar(32) NOT NULL DEFAULT '',
  `auto_generated` tinyint(1) NOT NULL DEFAULT '0',
  `start_date` date NOT NULL DEFAULT '1900-01-01',
  `draw_monday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_tuesday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_wednesday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_thursday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_friday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_saturday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_sunday` tinyint(1) NOT NULL DEFAULT '1',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `delayed_return` smallint unsigned NOT NULL DEFAULT '0',
  `end_date` date NOT NULL DEFAULT '1900-01-01',
  `allow_draw_changes` tinyint(1) NOT NULL DEFAULT '0',
  `drop_location` varchar(64) NOT NULL DEFAULT '',
  `sub_truck` varchar(64) NOT NULL DEFAULT '',
  `custom_1` varchar(256) NOT NULL DEFAULT '',
  `custom_2` varchar(256) NOT NULL DEFAULT '',
  `custom_3` varchar(256) NOT NULL DEFAULT '',
  `custom_4` varchar(256) NOT NULL DEFAULT '',
  `custom_5` varchar(256) NOT NULL DEFAULT '',
  `notes` text NOT NULL,
  `instructions` text NOT NULL,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `zone_id` varchar(64) NOT NULL DEFAULT '',
  `scan_account` tinyint(1) NOT NULL DEFAULT '1',
  `use_scan_sales` tinyint(1) NOT NULL DEFAULT '0',
  `scan_prediction` tinyint NOT NULL DEFAULT '0',
  PRIMARY KEY (`outlet_id`),
  KEY `outlet_name` (`outlet_name`),
  KEY `ext_id_1` (`ext_id_1`),
  KEY `active` (`active`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB AUTO_INCREMENT=506043 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `outlet_2025_03_27`
--

DROP TABLE IF EXISTS `outlet_2025_03_27`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `outlet_2025_03_27` (
  `outlet_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `id` int NOT NULL DEFAULT '0',
  `ext_id_1` varchar(32) NOT NULL DEFAULT '0',
  `peak_period` tinyint(1) NOT NULL DEFAULT '0',
  `sublets` mediumint NOT NULL DEFAULT '0',
  `outlet_name` varchar(64) NOT NULL DEFAULT '',
  `description` text NOT NULL,
  `phone_number` varchar(32) NOT NULL DEFAULT '',
  `street_and_number` varchar(64) NOT NULL DEFAULT '',
  `city_name` varchar(64) NOT NULL DEFAULT '',
  `city_code` varchar(64) NOT NULL DEFAULT '',
  `us_state_name` varchar(64) NOT NULL DEFAULT '',
  `zip_name` varchar(64) NOT NULL DEFAULT '',
  `zip_id` int NOT NULL DEFAULT '0',
  `county_id` varchar(64) NOT NULL DEFAULT '',
  `municipality_id` int NOT NULL DEFAULT '0',
  `district` varchar(128) NOT NULL DEFAULT '',
  `sub_district` varchar(64) NOT NULL DEFAULT '',
  `country_id` smallint NOT NULL DEFAULT '0',
  `longitude` char(9) NOT NULL DEFAULT '',
  `latitude` char(9) NOT NULL DEFAULT '',
  `publication` varchar(64) NOT NULL DEFAULT '',
  `carrier` varchar(64) NOT NULL DEFAULT '',
  `branch` varchar(64) NOT NULL DEFAULT '',
  `product` varchar(64) NOT NULL DEFAULT '',
  `truck` varchar(64) NOT NULL DEFAULT '',
  `sc_type` varchar(64) NOT NULL DEFAULT '',
  `tariff_model` tinyint NOT NULL DEFAULT '0',
  `outlet_type` varchar(64) DEFAULT NULL,
  `outlet_type_2` varchar(64) NOT NULL DEFAULT '',
  `zone_id_text` varchar(64) NOT NULL DEFAULT '',
  `rate_class_id` varchar(64) NOT NULL DEFAULT '',
  `pay_type` varchar(64) NOT NULL DEFAULT '',
  `chain_id` varchar(64) NOT NULL DEFAULT '',
  `area` varchar(32) NOT NULL DEFAULT '',
  `dc` varchar(32) NOT NULL DEFAULT '',
  `auto_generated` tinyint(1) NOT NULL DEFAULT '0',
  `start_date` date NOT NULL DEFAULT '1900-01-01',
  `draw_monday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_tuesday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_wednesday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_thursday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_friday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_saturday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_sunday` tinyint(1) NOT NULL DEFAULT '1',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `delayed_return` smallint unsigned NOT NULL DEFAULT '0',
  `end_date` date NOT NULL DEFAULT '1900-01-01',
  `allow_draw_changes` tinyint(1) NOT NULL DEFAULT '0',
  `drop_location` varchar(64) NOT NULL DEFAULT '',
  `sub_truck` varchar(64) NOT NULL DEFAULT '',
  `custom_1` varchar(256) NOT NULL DEFAULT '',
  `custom_2` varchar(256) NOT NULL DEFAULT '',
  `custom_3` varchar(256) NOT NULL DEFAULT '',
  `custom_4` varchar(256) NOT NULL DEFAULT '',
  `custom_5` varchar(256) NOT NULL DEFAULT '',
  `notes` text NOT NULL,
  `instructions` text NOT NULL,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `zone_id` varchar(64) NOT NULL DEFAULT '',
  `scan_account` tinyint(1) NOT NULL DEFAULT '1',
  `use_scan_sales` tinyint(1) NOT NULL DEFAULT '0',
  `scan_prediction` tinyint NOT NULL DEFAULT '0',
  PRIMARY KEY (`outlet_id`),
  KEY `outlet_name` (`outlet_name`),
  KEY `ext_id_1` (`ext_id_1`),
  KEY `active` (`active`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB AUTO_INCREMENT=506975 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `outlet_DOLLAR_STORE`
--

DROP TABLE IF EXISTS `outlet_DOLLAR_STORE`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `outlet_DOLLAR_STORE` (
  `outlet_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `id` int NOT NULL DEFAULT '0',
  `ext_id_1` varchar(32) NOT NULL DEFAULT '0',
  `peak_period` tinyint(1) NOT NULL DEFAULT '0',
  `sublets` mediumint NOT NULL DEFAULT '0',
  `outlet_name` varchar(64) NOT NULL DEFAULT '',
  `description` text NOT NULL,
  `phone_number` varchar(32) NOT NULL DEFAULT '',
  `street_and_number` varchar(64) NOT NULL DEFAULT '',
  `city_name` varchar(64) NOT NULL DEFAULT '',
  `city_code` varchar(64) NOT NULL DEFAULT '',
  `us_state_name` varchar(64) NOT NULL DEFAULT '',
  `zip_name` varchar(64) NOT NULL DEFAULT '',
  `zip_id` int NOT NULL DEFAULT '0',
  `county_id` varchar(64) NOT NULL DEFAULT '',
  `municipality_id` int NOT NULL DEFAULT '0',
  `district` varchar(128) NOT NULL DEFAULT '',
  `sub_district` varchar(64) NOT NULL DEFAULT '',
  `country_id` smallint NOT NULL DEFAULT '0',
  `longitude` char(9) NOT NULL DEFAULT '',
  `latitude` char(9) NOT NULL DEFAULT '',
  `publication` varchar(64) NOT NULL DEFAULT '',
  `carrier` varchar(64) NOT NULL DEFAULT '',
  `branch` varchar(64) NOT NULL DEFAULT '',
  `product` varchar(64) NOT NULL DEFAULT '',
  `truck` varchar(64) NOT NULL DEFAULT '',
  `sc_type` varchar(64) NOT NULL DEFAULT '',
  `tariff_model` tinyint NOT NULL DEFAULT '0',
  `outlet_type` varchar(64) DEFAULT NULL,
  `outlet_type_2` varchar(64) NOT NULL DEFAULT '',
  `zone_id_text` varchar(64) NOT NULL DEFAULT '',
  `rate_class_id` varchar(64) NOT NULL DEFAULT '',
  `pay_type` varchar(64) NOT NULL DEFAULT '',
  `chain_id` varchar(64) NOT NULL DEFAULT '',
  `area` varchar(32) NOT NULL DEFAULT '',
  `dc` varchar(32) NOT NULL DEFAULT '',
  `auto_generated` tinyint(1) NOT NULL DEFAULT '0',
  `start_date` date NOT NULL DEFAULT '1900-01-01',
  `draw_monday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_tuesday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_wednesday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_thursday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_friday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_saturday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_sunday` tinyint(1) NOT NULL DEFAULT '1',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `delayed_return` smallint unsigned NOT NULL DEFAULT '0',
  `end_date` date NOT NULL DEFAULT '1900-01-01',
  `allow_draw_changes` tinyint(1) NOT NULL DEFAULT '0',
  `drop_location` varchar(64) NOT NULL DEFAULT '',
  `sub_truck` varchar(64) NOT NULL DEFAULT '',
  `custom_1` varchar(256) NOT NULL DEFAULT '',
  `custom_2` varchar(256) NOT NULL DEFAULT '',
  `custom_3` varchar(256) NOT NULL DEFAULT '',
  `custom_4` varchar(256) NOT NULL DEFAULT '',
  `custom_5` varchar(256) NOT NULL DEFAULT '',
  `notes` text NOT NULL,
  `instructions` text NOT NULL,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `zone_id` varchar(64) NOT NULL DEFAULT '',
  `scan_account` tinyint(1) NOT NULL DEFAULT '1',
  `use_scan_sales` tinyint(1) NOT NULL DEFAULT '0',
  `scan_prediction` tinyint NOT NULL DEFAULT '0',
  PRIMARY KEY (`outlet_id`),
  KEY `outlet_name` (`outlet_name`),
  KEY `ext_id_1` (`ext_id_1`),
  KEY `active` (`active`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB AUTO_INCREMENT=506031 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `outlet_active`
--

DROP TABLE IF EXISTS `outlet_active`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `outlet_active` (
  `outlet_active_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `outlet_id` int unsigned NOT NULL,
  `ext_id_1` varchar(32) NOT NULL,
  `active_date` date NOT NULL,
  `active_monday` tinyint(1) NOT NULL DEFAULT '1',
  `active_tuesday` tinyint(1) NOT NULL DEFAULT '1',
  `active_wednesday` tinyint(1) NOT NULL DEFAULT '1',
  `active_thursday` tinyint(1) NOT NULL DEFAULT '1',
  `active_friday` tinyint(1) NOT NULL DEFAULT '1',
  `active_saturday` tinyint(1) NOT NULL DEFAULT '1',
  `active_sunday` tinyint(1) NOT NULL DEFAULT '1',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`outlet_active_id`),
  UNIQUE KEY `active_date_2` (`active_date`,`outlet_id`),
  KEY `outlet_id` (`outlet_id`),
  KEY `ext_id_1` (`ext_id_1`),
  KEY `active_date` (`active_date`)
) ENGINE=InnoDB AUTO_INCREMENT=316999 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `outlet_analytics`
--

DROP TABLE IF EXISTS `outlet_analytics`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `outlet_analytics` (
  `outlet_analytics_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `outlet_id` int unsigned NOT NULL,
  `ext_id_1` varchar(32) NOT NULL DEFAULT '',
  `day_of_week` tinyint NOT NULL DEFAULT '0',
  `analytics_type` tinyint NOT NULL DEFAULT '1',
  `publication_date` date NOT NULL,
  `observation_count` smallint unsigned NOT NULL DEFAULT '0',
  `delivered` smallint unsigned NOT NULL DEFAULT '0',
  `sold` smallint unsigned NOT NULL DEFAULT '0',
  `sold_max` smallint unsigned NOT NULL DEFAULT '0',
  `scan_sold` smallint unsigned NOT NULL DEFAULT '0',
  `scan_sold_max` smallint unsigned NOT NULL DEFAULT '0',
  `returned` smallint unsigned NOT NULL DEFAULT '0',
  `returned_max` smallint unsigned NOT NULL DEFAULT '0',
  `sold_out_count` tinyint unsigned NOT NULL DEFAULT '0',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `delivered_max` smallint unsigned NOT NULL DEFAULT '0',
  `amount` smallint unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`outlet_analytics_id`),
  KEY `outlet_id` (`outlet_id`)
) ENGINE=InnoDB AUTO_INCREMENT=16666332 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `outlet_cache`
--

DROP TABLE IF EXISTS `outlet_cache`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `outlet_cache` (
  `publication_id` int unsigned NOT NULL,
  `outlet_id` int unsigned NOT NULL,
  `scan_account` tinyint(1) NOT NULL DEFAULT '0',
  KEY `outlet_id` (`outlet_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `outlet_class`
--

DROP TABLE IF EXISTS `outlet_class`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `outlet_class` (
  `outlet_class_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `outlet_class_type` tinyint unsigned NOT NULL DEFAULT '1',
  `outlet_class_index` tinyint unsigned NOT NULL DEFAULT '1',
  `name` varchar(64) NOT NULL DEFAULT '',
  `description` text NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `public` tinyint(1) NOT NULL DEFAULT '1',
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`outlet_class_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB AUTO_INCREMENT=11252 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `outlet_class_member`
--

DROP TABLE IF EXISTS `outlet_class_member`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `outlet_class_member` (
  `outlet_class_member_id` int unsigned NOT NULL AUTO_INCREMENT,
  `outlet_class_id` int unsigned NOT NULL,
  `publication_id` int unsigned NOT NULL,
  `outlet_id` int unsigned NOT NULL,
  `ext_id_1` varchar(32) NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`outlet_class_member_id`),
  KEY `inx1` (`publication_id`,`active`),
  KEY `inx2` (`outlet_id`)
) ENGINE=InnoDB AUTO_INCREMENT=13396597 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `outlet_class_member_2015_01_29`
--

DROP TABLE IF EXISTS `outlet_class_member_2015_01_29`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `outlet_class_member_2015_01_29` (
  `outlet_class_member_id` int unsigned NOT NULL AUTO_INCREMENT,
  `outlet_class_id` int unsigned NOT NULL,
  `publication_id` int unsigned NOT NULL,
  `outlet_id` int unsigned NOT NULL,
  `ext_id_1` varchar(32) NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`outlet_class_member_id`),
  KEY `inx1` (`publication_id`,`active`),
  KEY `inx2` (`outlet_id`)
) ENGINE=InnoDB AUTO_INCREMENT=11396722 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `outlet_class_member_2025`
--

DROP TABLE IF EXISTS `outlet_class_member_2025`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `outlet_class_member_2025` (
  `outlet_class_member_id` int unsigned NOT NULL AUTO_INCREMENT,
  `outlet_class_id` int unsigned NOT NULL,
  `publication_id` int unsigned NOT NULL,
  `outlet_id` int unsigned NOT NULL,
  `ext_id_1` varchar(32) NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`outlet_class_member_id`),
  KEY `inx1` (`publication_id`,`active`),
  KEY `inx2` (`outlet_id`)
) ENGINE=InnoDB AUTO_INCREMENT=13035332 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `outlet_class_member_2025_01_15`
--

DROP TABLE IF EXISTS `outlet_class_member_2025_01_15`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `outlet_class_member_2025_01_15` (
  `outlet_class_member_id` int unsigned NOT NULL AUTO_INCREMENT,
  `outlet_class_id` int unsigned NOT NULL,
  `publication_id` int unsigned NOT NULL,
  `outlet_id` int unsigned NOT NULL,
  `ext_id_1` varchar(32) NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`outlet_class_member_id`),
  KEY `inx1` (`publication_id`,`active`),
  KEY `inx2` (`outlet_id`)
) ENGINE=InnoDB AUTO_INCREMENT=11321705 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `outlet_class_member_2025_01_24`
--

DROP TABLE IF EXISTS `outlet_class_member_2025_01_24`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `outlet_class_member_2025_01_24` (
  `outlet_class_member_id` int unsigned NOT NULL AUTO_INCREMENT,
  `outlet_class_id` int unsigned NOT NULL,
  `publication_id` int unsigned NOT NULL,
  `outlet_id` int unsigned NOT NULL,
  `ext_id_1` varchar(32) NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`outlet_class_member_id`),
  KEY `inx1` (`publication_id`,`active`),
  KEY `inx2` (`outlet_id`)
) ENGINE=InnoDB AUTO_INCREMENT=11358812 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `outlet_class_member_2025_02_12`
--

DROP TABLE IF EXISTS `outlet_class_member_2025_02_12`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `outlet_class_member_2025_02_12` (
  `outlet_class_member_id` int unsigned NOT NULL AUTO_INCREMENT,
  `outlet_class_id` int unsigned NOT NULL,
  `publication_id` int unsigned NOT NULL,
  `outlet_id` int unsigned NOT NULL,
  `ext_id_1` varchar(32) NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`outlet_class_member_id`),
  KEY `inx1` (`publication_id`,`active`),
  KEY `inx2` (`outlet_id`)
) ENGINE=InnoDB AUTO_INCREMENT=11472132 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `outlet_class_member_2025_02_26`
--

DROP TABLE IF EXISTS `outlet_class_member_2025_02_26`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `outlet_class_member_2025_02_26` (
  `outlet_class_member_id` int unsigned NOT NULL AUTO_INCREMENT,
  `outlet_class_id` int unsigned NOT NULL,
  `publication_id` int unsigned NOT NULL,
  `outlet_id` int unsigned NOT NULL,
  `ext_id_1` varchar(32) NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`outlet_class_member_id`),
  KEY `inx1` (`publication_id`,`active`),
  KEY `inx2` (`outlet_id`)
) ENGINE=InnoDB AUTO_INCREMENT=11556318 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `outlet_class_member_2025_11`
--

DROP TABLE IF EXISTS `outlet_class_member_2025_11`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `outlet_class_member_2025_11` (
  `outlet_class_member_id` int unsigned NOT NULL AUTO_INCREMENT,
  `outlet_class_id` int unsigned NOT NULL,
  `publication_id` int unsigned NOT NULL,
  `outlet_id` int unsigned NOT NULL,
  `ext_id_1` varchar(32) NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`outlet_class_member_id`),
  KEY `inx1` (`publication_id`,`active`),
  KEY `inx2` (`outlet_id`)
) ENGINE=InnoDB AUTO_INCREMENT=12992454 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `outlet_class_member_2026_02_20`
--

DROP TABLE IF EXISTS `outlet_class_member_2026_02_20`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `outlet_class_member_2026_02_20` (
  `outlet_class_member_id` int unsigned NOT NULL AUTO_INCREMENT,
  `outlet_class_id` int unsigned NOT NULL,
  `publication_id` int unsigned NOT NULL,
  `outlet_id` int unsigned NOT NULL,
  `ext_id_1` varchar(32) NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`outlet_class_member_id`),
  KEY `inx1` (`publication_id`,`active`),
  KEY `inx2` (`outlet_id`)
) ENGINE=InnoDB AUTO_INCREMENT=13331166 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `outlet_class_member_BACK`
--

DROP TABLE IF EXISTS `outlet_class_member_BACK`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `outlet_class_member_BACK` (
  `outlet_class_member_id` int unsigned NOT NULL AUTO_INCREMENT,
  `outlet_class_id` int unsigned NOT NULL,
  `publication_id` int unsigned NOT NULL,
  `outlet_id` int unsigned NOT NULL,
  `ext_id_1` varchar(32) NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`outlet_class_member_id`),
  KEY `inx1` (`publication_id`,`active`),
  KEY `inx2` (`outlet_id`)
) ENGINE=InnoDB AUTO_INCREMENT=11097164 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `outlet_class_member_EXCEPTION_LIST`
--

DROP TABLE IF EXISTS `outlet_class_member_EXCEPTION_LIST`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `outlet_class_member_EXCEPTION_LIST` (
  `outlet_class_member_id` int unsigned NOT NULL AUTO_INCREMENT,
  `outlet_class_id` int unsigned NOT NULL,
  `publication_id` int unsigned NOT NULL,
  `outlet_id` int unsigned NOT NULL,
  `ext_id_1` varchar(32) NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`outlet_class_member_id`),
  KEY `inx1` (`publication_id`,`active`),
  KEY `inx2` (`outlet_id`)
) ENGINE=InnoDB AUTO_INCREMENT=11197238 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `outlet_delivery`
--

DROP TABLE IF EXISTS `outlet_delivery`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `outlet_delivery` (
  `outlet_delivery_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `outlet_id` int unsigned NOT NULL,
  `day_of_week` tinyint unsigned NOT NULL,
  `minimum_delivery` int unsigned NOT NULL DEFAULT '0',
  `fixed_delivery` int unsigned NOT NULL DEFAULT '0',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `allow_returns` tinyint(1) NOT NULL DEFAULT '1',
  `allow_forecast` tinyint(1) NOT NULL DEFAULT '1',
  `default_delivery` smallint unsigned NOT NULL DEFAULT '0',
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `added_delivery` smallint unsigned NOT NULL DEFAULT '0',
  `added_delivery_pct` smallint unsigned NOT NULL DEFAULT '0',
  `allow_draw_changes` tinyint(1) NOT NULL DEFAULT '0',
  `maximum_delivery` smallint unsigned NOT NULL DEFAULT '0',
  `minimum_delivery_timeout` date NOT NULL DEFAULT '2100-01-01',
  `maximum_delivery_timeout` date NOT NULL DEFAULT '2100-01-01',
  `fixed_delivery_timeout` date NOT NULL DEFAULT '2100-01-01',
  `default_delivery_timeout` date NOT NULL DEFAULT '2100-01-01',
  `added_delivery_timeout` date NOT NULL DEFAULT '2100-01-01',
  `added_delivery_pct_timeout` date NOT NULL DEFAULT '2100-01-01',
  `minimum_return_pct` float unsigned NOT NULL DEFAULT '0',
  `maximum_return_pct` float unsigned NOT NULL DEFAULT '0',
  `minimum_return_pct_timeout` date NOT NULL DEFAULT '2100-01-01',
  `maximum_return_pct_timeout` date NOT NULL DEFAULT '2100-01-01',
  PRIMARY KEY (`outlet_delivery_id`),
  KEY `publication_id` (`publication_id`),
  KEY `outlet_id` (`outlet_id`)
) ENGINE=InnoDB AUTO_INCREMENT=2214977 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `outlet_draw_event`
--

DROP TABLE IF EXISTS `outlet_draw_event`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `outlet_draw_event` (
  `outlet_draw_event_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `outlet_id` int unsigned NOT NULL,
  `name` varchar(64) NOT NULL DEFAULT '',
  `event_type` tinyint unsigned NOT NULL DEFAULT '0',
  `day_of_week` tinyint unsigned NOT NULL,
  `event_date` date NOT NULL DEFAULT '2100-01-01',
  `onwards` tinyint(1) NOT NULL DEFAULT '0',
  `event_value_bool` tinyint(1) NOT NULL DEFAULT '0',
  `event_value_number` smallint unsigned NOT NULL DEFAULT '0',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`outlet_draw_event_id`),
  KEY `publication_id` (`publication_id`),
  KEY `outlet_id` (`outlet_id`)
) ENGINE=InnoDB AUTO_INCREMENT=30 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `outlet_group`
--

DROP TABLE IF EXISTS `outlet_group`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `outlet_group` (
  `outlet_group_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `day_of_week` tinyint unsigned NOT NULL DEFAULT '0',
  `outlet_group_type` tinyint NOT NULL DEFAULT '1',
  `outlet_group_name` varchar(255) NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`outlet_group_id`),
  KEY `outlet_group_name` (`outlet_group_name`)
) ENGINE=InnoDB AUTO_INCREMENT=25418 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `outlet_has_outlet_group`
--

DROP TABLE IF EXISTS `outlet_has_outlet_group`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `outlet_has_outlet_group` (
  `outlet_has_outlet_group_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `outlet_id` int unsigned NOT NULL,
  `outlet_group_id` int unsigned NOT NULL,
  `day_of_week` tinyint NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`outlet_has_outlet_group_id`),
  KEY `outlet_id` (`outlet_id`),
  KEY `outlet_group_id` (`outlet_group_id`)
) ENGINE=InnoDB AUTO_INCREMENT=32094212 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `outlet_special_handling`
--

DROP TABLE IF EXISTS `outlet_special_handling`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `outlet_special_handling` (
  `outlet_special_handling_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `outlet_id` int unsigned NOT NULL,
  `day_of_week` tinyint unsigned NOT NULL DEFAULT '0',
  `description` text NOT NULL,
  `increase_amount` smallint NOT NULL DEFAULT '0',
  `increase_percentage` smallint NOT NULL DEFAULT '0',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`outlet_special_handling_id`),
  KEY `publication_id` (`publication_id`),
  KEY `outlet_id` (`outlet_id`)
) ENGINE=InnoDB AUTO_INCREMENT=18 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `outlet_stats`
--

DROP TABLE IF EXISTS `outlet_stats`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `outlet_stats` (
  `outlet_stats_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `outlet_id` int unsigned NOT NULL,
  `total_delivered` int unsigned NOT NULL,
  `total_returned` int unsigned NOT NULL,
  `total_sold` int unsigned NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`outlet_stats_id`),
  UNIQUE KEY `outlet_id` (`outlet_id`)
) ENGINE=InnoDB AUTO_INCREMENT=186719 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `parse_error`
--

DROP TABLE IF EXISTS `parse_error`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `parse_error` (
  `parse_error_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `parse_date` date NOT NULL,
  `error_type` tinyint NOT NULL DEFAULT '0',
  `destination_type` tinyint NOT NULL DEFAULT '0',
  `description` text NOT NULL,
  `source_filename` text NOT NULL,
  `line_number` int NOT NULL DEFAULT '0',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`parse_error_id`),
  KEY `publication_id` (`publication_id`),
  KEY `parse_date` (`parse_date`)
) ENGINE=InnoDB AUTO_INCREMENT=338 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `peak_period`
--

DROP TABLE IF EXISTS `peak_period`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `peak_period` (
  `peak_period_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `peak_period_group_id` int unsigned NOT NULL,
  `date_start` date NOT NULL,
  `date_end` date NOT NULL,
  `day_of_week` tinyint NOT NULL,
  `type` tinyint unsigned NOT NULL,
  `variation_reduction` tinyint unsigned NOT NULL DEFAULT '100',
  `pad` mediumint NOT NULL DEFAULT '100',
  `comment` text NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `allow_negative` tinyint(1) NOT NULL DEFAULT '0',
  `booster_pad` mediumint NOT NULL DEFAULT '100',
  `booster_std` mediumint NOT NULL DEFAULT '100',
  `outlet_class_id` int unsigned NOT NULL DEFAULT '0',
  `historic_days` smallint unsigned NOT NULL DEFAULT '1095',
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `publish` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`peak_period_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB AUTO_INCREMENT=58372 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `peak_period_class`
--

DROP TABLE IF EXISTS `peak_period_class`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `peak_period_class` (
  `peak_period_class_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `outlet_class_id` int unsigned NOT NULL,
  `peak_period_group_id` int unsigned NOT NULL,
  `date_start` date NOT NULL,
  `date_end` date NOT NULL,
  `day_of_week` tinyint NOT NULL,
  `type` tinyint NOT NULL,
  `variation_reduction` tinyint NOT NULL DEFAULT '100',
  `pad` mediumint NOT NULL DEFAULT '100',
  `comment` text NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT '0000-00-00 00:00:00',
  PRIMARY KEY (`peak_period_class_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `peak_period_shift`
--

DROP TABLE IF EXISTS `peak_period_shift`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `peak_period_shift` (
  `peak_period_shift_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `date_start` date NOT NULL,
  `date_end` date NOT NULL,
  `foreign_peak_period_group_id` int unsigned NOT NULL,
  `comment` text NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`peak_period_shift_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `period`
--

DROP TABLE IF EXISTS `period`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `period` (
  `period_id` int unsigned NOT NULL AUTO_INCREMENT,
  `type` smallint unsigned NOT NULL,
  `year` smallint unsigned NOT NULL,
  `day_of_year_start` smallint unsigned NOT NULL,
  `day_of_year_end` smallint unsigned NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT '0000-00-00 00:00:00',
  PRIMARY KEY (`period_id`),
  KEY `type` (`type`,`year`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `phi`
--

DROP TABLE IF EXISTS `phi`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `phi` (
  `phi_id` smallint unsigned NOT NULL AUTO_INCREMENT,
  `value` double unsigned NOT NULL,
  PRIMARY KEY (`phi_id`)
) ENGINE=InnoDB AUTO_INCREMENT=1001 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `phi_inverse`
--

DROP TABLE IF EXISTS `phi_inverse`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `phi_inverse` (
  `phi_inverse_id` smallint unsigned NOT NULL AUTO_INCREMENT,
  `value` double unsigned NOT NULL,
  PRIMARY KEY (`phi_inverse_id`)
) ENGINE=InnoDB AUTO_INCREMENT=2001 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `prediction`
--

DROP TABLE IF EXISTS `prediction`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `prediction` (
  `prediction_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `outlet_id` int unsigned NOT NULL,
  `day_of_week` tinyint NOT NULL,
  `prediction` double NOT NULL DEFAULT '0',
  `standard_deviation` double NOT NULL DEFAULT '0',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actual_prediction` double NOT NULL DEFAULT '0',
  `draw_prediction` double NOT NULL DEFAULT '0',
  `shrinkage_ratio` double NOT NULL DEFAULT '0',
  PRIMARY KEY (`prediction_id`),
  KEY `publication_id` (`publication_id`),
  KEY `outlet_id` (`outlet_id`)
) ENGINE=InnoDB AUTO_INCREMENT=363815719 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `publication`
--

DROP TABLE IF EXISTS `publication`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `publication` (
  `publication_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_name` varchar(64) NOT NULL DEFAULT '',
  `description` text NOT NULL,
  `cps_name` varchar(4) NOT NULL DEFAULT '',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `sandbox` tinyint(1) NOT NULL DEFAULT '0',
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`publication_id`),
  KEY `publication_name` (`publication_name`)
) ENGINE=InnoDB AUTO_INCREMENT=457 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `publication__frontend`
--

DROP TABLE IF EXISTS `publication__frontend`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `publication__frontend` (
  `publication__frontend_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `status` varchar(64) NOT NULL DEFAULT '',
  `locked` tinyint(1) NOT NULL DEFAULT '1',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT '0000-00-00 00:00:00',
  PRIMARY KEY (`publication__frontend_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `publication_contact`
--

DROP TABLE IF EXISTS `publication_contact`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `publication_contact` (
  `publication_contact_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `name` varchar(64) NOT NULL DEFAULT '',
  `email` varchar(64) NOT NULL DEFAULT '',
  `phone` varchar(64) NOT NULL DEFAULT '',
  `title` varchar(64) NOT NULL DEFAULT '',
  `comments` text NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `sex` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`publication_contact_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB AUTO_INCREMENT=59 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `publication_info`
--

DROP TABLE IF EXISTS `publication_info`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `publication_info` (
  `publication_info_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `comments` text NOT NULL,
  `status` varchar(64) NOT NULL DEFAULT '',
  `locked` tinyint(1) NOT NULL DEFAULT '1',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`publication_info_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `publication_setup`
--

DROP TABLE IF EXISTS `publication_setup`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `publication_setup` (
  `publication_setup_id` smallint unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `currency` varchar(12) NOT NULL DEFAULT 'kr',
  `allow_from` text NOT NULL,
  `deny_from` text NOT NULL,
  `use_passive_ftp` tinyint(1) NOT NULL DEFAULT '0',
  `ftp_home` varchar(255) NOT NULL DEFAULT '',
  `use_active_ftp` tinyint(1) NOT NULL DEFAULT '0',
  `ftp_server` varchar(255) NOT NULL DEFAULT '',
  `ftp_user` varchar(255) NOT NULL DEFAULT '',
  `ftp_password` varchar(255) NOT NULL DEFAULT '',
  `ftp_directory` varchar(255) NOT NULL DEFAULT '',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`publication_setup_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB AUTO_INCREMENT=42 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `publication_stat`
--

DROP TABLE IF EXISTS `publication_stat`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `publication_stat` (
  `publication_stat_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `publication_stat_date` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `outlets_total` int NOT NULL DEFAULT '0',
  `outlets_last_week` int NOT NULL DEFAULT '0',
  `outlets_prior_week` int NOT NULL DEFAULT '0',
  `outlets_last_upload` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `sales_data_total` int NOT NULL DEFAULT '0',
  `sales_data_last_year` int NOT NULL DEFAULT '0',
  `sales_data_last_month` int NOT NULL DEFAULT '0',
  `sales_data_last_week` int NOT NULL DEFAULT '0',
  `sales_data_prior_week` int NOT NULL DEFAULT '0',
  `sales_data_last_upload` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `sales_data_max_publication_date` date NOT NULL DEFAULT '2010-01-01',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`publication_stat_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `publication_stats`
--

DROP TABLE IF EXISTS `publication_stats`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `publication_stats` (
  `publication_stats_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL DEFAULT '0',
  `publication_stats_date` date NOT NULL,
  `active_outlets` int NOT NULL DEFAULT '0',
  `last_week_sum_draw` int NOT NULL DEFAULT '0',
  `last_week_sum_sold` int NOT NULL DEFAULT '0',
  `last_week_sum_returned` int NOT NULL DEFAULT '0',
  `last_week_sum_sold_out` int NOT NULL DEFAULT '0',
  `last_month_sum_draw` int NOT NULL DEFAULT '0',
  `last_month_sum_sold` int NOT NULL DEFAULT '0',
  `last_month_sum_returned` int NOT NULL DEFAULT '0',
  `last_month_sum_sold_out` int NOT NULL DEFAULT '0',
  `last_three_month_sum_draw` int NOT NULL DEFAULT '0',
  `last_three_month_sum_sold` int NOT NULL DEFAULT '0',
  `last_three_month_sum_returned` int NOT NULL DEFAULT '0',
  `last_three_month_sum_sold_out` int NOT NULL DEFAULT '0',
  `min_sales_date` date NOT NULL,
  `max_sales_date` date NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`publication_stats_id`)
) ENGINE=InnoDB AUTO_INCREMENT=15016 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sales_data`
--

DROP TABLE IF EXISTS `sales_data`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sales_data` (
  `sales_data_id` int unsigned NOT NULL AUTO_INCREMENT,
  `ext_id_1` varchar(32) NOT NULL DEFAULT '0',
  `publication_id` int unsigned NOT NULL,
  `outlet_id` int unsigned NOT NULL DEFAULT '0',
  `publication_date` date NOT NULL,
  `delivered` mediumint unsigned NOT NULL,
  `returned` mediumint unsigned NOT NULL,
  `sold` mediumint unsigned NOT NULL,
  `day_of_week` tinyint unsigned NOT NULL DEFAULT '0',
  `day_of_year` smallint unsigned NOT NULL DEFAULT '0',
  `year` smallint unsigned NOT NULL DEFAULT '0',
  `rad` double unsigned NOT NULL DEFAULT '0',
  `sales_normalization` double unsigned NOT NULL DEFAULT '0',
  `washed` tinyint(1) NOT NULL DEFAULT '0',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `scan_sold` mediumint unsigned NOT NULL DEFAULT '0',
  `net_sold` mediumint unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`sales_data_id`),
  KEY `publication_id` (`publication_id`),
  KEY `outlet_id` (`outlet_id`),
  KEY `publication_date` (`publication_date`),
  KEY `publication_id_2` (`publication_id`,`outlet_id`),
  KEY `publication_id_3` (`publication_id`,`outlet_id`,`publication_date`),
  KEY `active` (`active`)
) ENGINE=InnoDB AUTO_INCREMENT=521835481 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sales_data_cache`
--

DROP TABLE IF EXISTS `sales_data_cache`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sales_data_cache` (
  `sales_data_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `outlet_id` int unsigned NOT NULL DEFAULT '0',
  `ext_id_1` varchar(32) NOT NULL DEFAULT '0',
  `publication_date` date NOT NULL,
  `day_of_week` tinyint unsigned NOT NULL DEFAULT '0',
  `delivered` mediumint unsigned NOT NULL,
  `returned` mediumint unsigned NOT NULL,
  `sold` mediumint unsigned NOT NULL,
  `scan_sold` mediumint unsigned NOT NULL DEFAULT '0',
  `raw_scan_sold` mediumint unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`sales_data_id`),
  KEY `outlet_id` (`outlet_id`),
  KEY `publication_date` (`publication_date`),
  KEY `outlet_id_2` (`outlet_id`,`publication_date`)
) ENGINE=InnoDB AUTO_INCREMENT=2021825585 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sales_filter`
--

DROP TABLE IF EXISTS `sales_filter`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sales_filter` (
  `sales_filter_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `filter_date` date NOT NULL,
  `name` varchar(64) NOT NULL DEFAULT '',
  `description` text NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`sales_filter_id`),
  KEY `filter_date` (`filter_date`)
) ENGINE=InnoDB AUTO_INCREMENT=4005 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sales_filter_specific`
--

DROP TABLE IF EXISTS `sales_filter_specific`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sales_filter_specific` (
  `sales_filter_specific_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `filter_date` date NOT NULL,
  `outlet_id` int unsigned NOT NULL DEFAULT '0',
  `outlet_class_id` int unsigned NOT NULL DEFAULT '0',
  `name` varchar(64) NOT NULL DEFAULT '',
  `description` text NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`sales_filter_specific_id`),
  KEY `filter_date` (`filter_date`),
  KEY `outlet_id` (`outlet_id`),
  KEY `outlet_class_id` (`outlet_class_id`)
) ENGINE=InnoDB AUTO_INCREMENT=176 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sales_observation`
--

DROP TABLE IF EXISTS `sales_observation`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sales_observation` (
  `sales_observation_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `name` varchar(64) NOT NULL DEFAULT '',
  `description` text NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`sales_observation_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sales_observation_line`
--

DROP TABLE IF EXISTS `sales_observation_line`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sales_observation_line` (
  `sales_observation_line_id` int unsigned NOT NULL AUTO_INCREMENT,
  `sales_observation_id` int unsigned NOT NULL,
  `sales_data_id` int unsigned NOT NULL,
  `publication_id` int unsigned NOT NULL,
  `outlet_id` int unsigned NOT NULL DEFAULT '0',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`sales_observation_line_id`),
  KEY `sales_observation_id` (`sales_observation_id`),
  KEY `sales_data_id` (`sales_data_id`),
  KEY `publication_id` (`publication_id`),
  KEY `outlet_id` (`outlet_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sales_outlier_analytics`
--

DROP TABLE IF EXISTS `sales_outlier_analytics`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sales_outlier_analytics` (
  `outlet_analytics_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `outlet_id` int unsigned NOT NULL,
  `ext_id_1` varchar(32) NOT NULL DEFAULT '',
  `outlier_type` tinyint NOT NULL DEFAULT '1',
  `publication_date` date NOT NULL,
  `day_of_week` tinyint NOT NULL DEFAULT '0',
  `delivered` mediumint unsigned NOT NULL,
  `returned` mediumint unsigned NOT NULL,
  `sold` mediumint unsigned NOT NULL,
  `scan_sold` mediumint unsigned NOT NULL DEFAULT '0',
  `average_delivered` mediumint unsigned NOT NULL,
  `average_returned` mediumint unsigned NOT NULL,
  `average_sold` mediumint unsigned NOT NULL,
  `average_scan_sold` mediumint unsigned NOT NULL DEFAULT '0',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`outlet_analytics_id`),
  KEY `outlet_id` (`outlet_id`)
) ENGINE=InnoDB AUTO_INCREMENT=80210 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `shrinkage_multiplication`
--

DROP TABLE IF EXISTS `shrinkage_multiplication`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `shrinkage_multiplication` (
  `shrinkage_multiplication_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `outlet_id` int unsigned NOT NULL,
  `ext_id_1` varchar(32) NOT NULL DEFAULT '0',
  `day_of_week` tinyint unsigned NOT NULL,
  `factor` float unsigned NOT NULL DEFAULT '0',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`shrinkage_multiplication_id`),
  KEY `publication_id` (`publication_id`),
  KEY `outlet_id` (`outlet_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `simulation`
--

DROP TABLE IF EXISTS `simulation`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `simulation` (
  `simulation_id` int unsigned NOT NULL AUTO_INCREMENT,
  `simulation_head_id` int unsigned NOT NULL,
  `publication_id` int unsigned NOT NULL,
  `strategy_calculation_id` int unsigned NOT NULL,
  `simulation_date` date NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`simulation_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB AUTO_INCREMENT=19173 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `simulation_alpha`
--

DROP TABLE IF EXISTS `simulation_alpha`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `simulation_alpha` (
  `simulation_alpha_id` int unsigned NOT NULL AUTO_INCREMENT,
  `simulation_id` int unsigned NOT NULL,
  `publication_id` int unsigned NOT NULL,
  `outlet_id` int unsigned NOT NULL,
  `day_of_week` tinyint NOT NULL,
  `alpha` decimal(12,6) NOT NULL DEFAULT '0.000000',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`simulation_alpha_id`),
  KEY `publication_id` (`publication_id`),
  KEY `simulation_id` (`simulation_id`),
  KEY `outlet_id` (`outlet_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `simulation_gamma`
--

DROP TABLE IF EXISTS `simulation_gamma`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `simulation_gamma` (
  `simulation_gamma_id` int unsigned NOT NULL AUTO_INCREMENT,
  `simulation_id` int unsigned NOT NULL,
  `publication_id` int unsigned NOT NULL,
  `outlet_id` int unsigned NOT NULL,
  `day_of_week` tinyint NOT NULL,
  `peak_period_group_id` int unsigned NOT NULL,
  `gamma` decimal(12,6) NOT NULL DEFAULT '0.000000',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`simulation_gamma_id`),
  KEY `publication_id` (`publication_id`),
  KEY `simulation_id` (`simulation_id`),
  KEY `outlet_id` (`outlet_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `simulation_head`
--

DROP TABLE IF EXISTS `simulation_head`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `simulation_head` (
  `simulation_head_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `name` varchar(128) NOT NULL DEFAULT '',
  `description` text NOT NULL,
  `mark` varchar(16) NOT NULL DEFAULT '',
  `needle` varchar(64) NOT NULL DEFAULT '',
  `cassandra_call` varchar(512) NOT NULL DEFAULT '',
  `simulation_type` tinyint NOT NULL DEFAULT '0',
  `contemporary` tinyint(1) NOT NULL DEFAULT '0',
  `track_days` smallint NOT NULL DEFAULT '0',
  `template_id` int unsigned NOT NULL DEFAULT '0',
  `date_from` date NOT NULL DEFAULT '2010-01-01',
  `date_to` date NOT NULL DEFAULT '2010-01-01',
  `day_of_week` tinyint NOT NULL DEFAULT '0',
  `finished` tinyint(1) NOT NULL DEFAULT '0',
  `started_time` timestamp NOT NULL DEFAULT '2010-01-01 00:00:00',
  `finished_time` timestamp NOT NULL DEFAULT '2010-01-01 00:00:00',
  `number_of_dates` smallint NOT NULL DEFAULT '0',
  `current_progress` smallint NOT NULL DEFAULT '0',
  `status` tinyint NOT NULL DEFAULT '1',
  `totals_calculated` tinyint(1) DEFAULT '0',
  `value_publication` float NOT NULL DEFAULT '0',
  `value_simulation` float NOT NULL DEFAULT '0',
  `added_profit` float NOT NULL DEFAULT '0',
  `sales_data_draw` int unsigned NOT NULL DEFAULT '0',
  `sales_data_sales` int unsigned NOT NULL DEFAULT '0',
  `sales_data_return` int unsigned NOT NULL DEFAULT '0',
  `simulation_draw` int unsigned NOT NULL DEFAULT '0',
  `diff` int NOT NULL DEFAULT '0',
  `diff_less` int unsigned NOT NULL DEFAULT '0',
  `diff_more` int unsigned NOT NULL DEFAULT '0',
  `diff_less_good` int unsigned NOT NULL DEFAULT '0',
  `diff_less_bad` int unsigned NOT NULL DEFAULT '0',
  `diff_more_good` int unsigned NOT NULL DEFAULT '0',
  `diff_more_bad` int unsigned NOT NULL DEFAULT '0',
  `unique_outlet_count` int unsigned NOT NULL DEFAULT '0',
  `sales_data_observations` int unsigned NOT NULL DEFAULT '0',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`simulation_head_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB AUTO_INCREMENT=102 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `simulation_prediction`
--

DROP TABLE IF EXISTS `simulation_prediction`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `simulation_prediction` (
  `simulation_prediction_id` int unsigned NOT NULL AUTO_INCREMENT,
  `simulation_id` int unsigned NOT NULL,
  `publication_id` int unsigned NOT NULL,
  `outlet_id` int unsigned NOT NULL,
  `day_of_week` tinyint NOT NULL,
  `prediction` double NOT NULL DEFAULT '0',
  `standard_deviation` double NOT NULL DEFAULT '0',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`simulation_prediction_id`),
  KEY `publication_id` (`publication_id`),
  KEY `simulation_id` (`simulation_id`),
  KEY `publication_id_2` (`publication_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `simulation_theta`
--

DROP TABLE IF EXISTS `simulation_theta`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `simulation_theta` (
  `simulation_theta_id` int unsigned NOT NULL AUTO_INCREMENT,
  `simulation_id` int unsigned NOT NULL,
  `publication_id` int unsigned NOT NULL,
  `outlet_group_id` int unsigned NOT NULL,
  `day_of_week` tinyint NOT NULL,
  `theta_1` decimal(12,6) NOT NULL DEFAULT '0.000000',
  `theta_2` decimal(12,6) NOT NULL DEFAULT '0.000000',
  `theta_3` decimal(12,6) NOT NULL DEFAULT '0.000000',
  `theta_4` decimal(12,6) NOT NULL DEFAULT '0.000000',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`simulation_theta_id`),
  KEY `publication_id` (`publication_id`),
  KEY `simulation_id` (`simulation_id`),
  KEY `outlet_group_id` (`outlet_group_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `statistics_profile`
--

DROP TABLE IF EXISTS `statistics_profile`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `statistics_profile` (
  `statistics_profile_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `statistics_type` tinyint unsigned NOT NULL DEFAULT '0',
  `name` varchar(64) NOT NULL DEFAULT 'Unnamed',
  `production_class_id` int unsigned NOT NULL DEFAULT '0',
  `weekday` tinyint unsigned NOT NULL DEFAULT '0',
  `draw_min` smallint unsigned NOT NULL DEFAULT '0',
  `draw_max` smallint unsigned NOT NULL DEFAULT '0',
  `sold_min` smallint unsigned NOT NULL DEFAULT '0',
  `sold_max` smallint unsigned NOT NULL DEFAULT '0',
  `return_min` smallint unsigned NOT NULL DEFAULT '0',
  `return_max` smallint unsigned NOT NULL DEFAULT '0',
  `datatype` tinyint unsigned NOT NULL DEFAULT '0',
  `sum` tinyint unsigned NOT NULL DEFAULT '0',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `constraint_list` varchar(2048) NOT NULL DEFAULT '',
  `active_list` varchar(2048) NOT NULL DEFAULT '',
  PRIMARY KEY (`statistics_profile_id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `strategy_calculation`
--

DROP TABLE IF EXISTS `strategy_calculation`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `strategy_calculation` (
  `strategy_calculation_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `strategy_calculation_date` date NOT NULL,
  `strategy_template_id` int unsigned NOT NULL,
  `base_increase_by_percentage_overall_pre` int unsigned NOT NULL,
  `service_degree` int unsigned NOT NULL,
  `service_degree_2` int unsigned NOT NULL,
  `increase_by_percentage_per_outlet` int unsigned NOT NULL,
  `increase_by_percentage_overall_post` int unsigned NOT NULL,
  `disregard_fixed_deliveries` tinyint(1) NOT NULL DEFAULT '0',
  `disregard_minimum_deliveries` tinyint(1) NOT NULL DEFAULT '0',
  `disregard_maximum_deliveries` tinyint(1) NOT NULL DEFAULT '0',
  `disregard_maximum_return_pct` tinyint(1) NOT NULL DEFAULT '0',
  `amount` int unsigned NOT NULL,
  `expected_return` double NOT NULL DEFAULT '0',
  `expected_demand` double NOT NULL DEFAULT '0',
  `expected_sale` double NOT NULL DEFAULT '0',
  `expected_return_percentage` double NOT NULL DEFAULT '0',
  `expected_profit` double NOT NULL DEFAULT '0',
  `percentage_sold_out` double NOT NULL DEFAULT '0',
  `name` varchar(64) NOT NULL DEFAULT '',
  `reduced` tinyint(1) NOT NULL DEFAULT '0',
  `comments` text NOT NULL,
  `mark` varchar(64) NOT NULL DEFAULT '',
  `bi_mark` varchar(16) NOT NULL DEFAULT '',
  `has_calculation_specifications` tinyint(1) NOT NULL DEFAULT '0',
  `is_experiment` tinyint(1) NOT NULL DEFAULT '0',
  `is_production` tinyint(1) NOT NULL DEFAULT '0',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`strategy_calculation_id`),
  KEY `strategy_template_id` (`strategy_template_id`,`strategy_calculation_date`),
  KEY `strategy_calculation_date` (`strategy_calculation_date`),
  KEY `active` (`active`)
) ENGINE=InnoDB AUTO_INCREMENT=5265 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `strategy_calculation_2025`
--

DROP TABLE IF EXISTS `strategy_calculation_2025`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `strategy_calculation_2025` (
  `strategy_calculation_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `strategy_calculation_date` date NOT NULL,
  `strategy_template_id` int unsigned NOT NULL,
  `base_increase_by_percentage_overall_pre` int unsigned NOT NULL,
  `service_degree` int unsigned NOT NULL,
  `service_degree_2` int unsigned NOT NULL,
  `increase_by_percentage_per_outlet` int unsigned NOT NULL,
  `increase_by_percentage_overall_post` int unsigned NOT NULL,
  `disregard_fixed_deliveries` tinyint(1) NOT NULL DEFAULT '0',
  `disregard_minimum_deliveries` tinyint(1) NOT NULL DEFAULT '0',
  `disregard_maximum_deliveries` tinyint(1) NOT NULL DEFAULT '0',
  `disregard_maximum_return_pct` tinyint(1) NOT NULL DEFAULT '0',
  `amount` int unsigned NOT NULL,
  `expected_return` double NOT NULL DEFAULT '0',
  `expected_demand` double NOT NULL DEFAULT '0',
  `expected_sale` double NOT NULL DEFAULT '0',
  `expected_return_percentage` double NOT NULL DEFAULT '0',
  `expected_profit` double NOT NULL DEFAULT '0',
  `percentage_sold_out` double NOT NULL DEFAULT '0',
  `name` varchar(64) NOT NULL DEFAULT '',
  `reduced` tinyint(1) NOT NULL DEFAULT '0',
  `comments` text NOT NULL,
  `mark` varchar(64) NOT NULL DEFAULT '',
  `bi_mark` varchar(16) NOT NULL DEFAULT '',
  `has_calculation_specifications` tinyint(1) NOT NULL DEFAULT '0',
  `is_experiment` tinyint(1) NOT NULL DEFAULT '0',
  `is_production` tinyint(1) NOT NULL DEFAULT '0',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`strategy_calculation_id`),
  KEY `strategy_template_id` (`strategy_template_id`,`strategy_calculation_date`),
  KEY `strategy_calculation_date` (`strategy_calculation_date`),
  KEY `active` (`active`)
) ENGINE=InnoDB AUTO_INCREMENT=146316 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `strategy_calculation_line`
--

DROP TABLE IF EXISTS `strategy_calculation_line`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `strategy_calculation_line` (
  `strategy_calculation_line_id` int unsigned NOT NULL AUTO_INCREMENT,
  `strategy_calculation_id` int unsigned NOT NULL,
  `outlet_id` int unsigned NOT NULL,
  `fixed_amount` tinyint(1) NOT NULL DEFAULT '0',
  `minimum_amount` tinyint(1) NOT NULL DEFAULT '0',
  `maximum_amount` tinyint(1) NOT NULL DEFAULT '0',
  `maximum_return_percentage_ceil` tinyint(1) NOT NULL DEFAULT '0',
  `fixed_adjustment` tinyint(1) NOT NULL DEFAULT '0',
  `max_return_percentage` float unsigned NOT NULL DEFAULT '0',
  `draw_floor_adjustment` smallint unsigned NOT NULL DEFAULT '0',
  `pre_unified_amount` smallint unsigned NOT NULL,
  `amount` smallint unsigned NOT NULL,
  `unified_amount` smallint unsigned NOT NULL DEFAULT '0',
  `expected_return` double unsigned NOT NULL DEFAULT '0',
  `expected_return_percentage` float unsigned NOT NULL DEFAULT '0',
  `expected_demand` double NOT NULL DEFAULT '0',
  `expected_sale` double NOT NULL DEFAULT '0',
  `expected_profit` double NOT NULL DEFAULT '0',
  `service_degree_1` double unsigned NOT NULL DEFAULT '0',
  `service_degree_2` double unsigned NOT NULL DEFAULT '0',
  `norm_factor` double unsigned NOT NULL DEFAULT '0',
  `season_trend` double NOT NULL DEFAULT '0',
  `peak_period` double NOT NULL DEFAULT '0',
  `prediction` double NOT NULL DEFAULT '0',
  `standard_deviation` double unsigned NOT NULL DEFAULT '0',
  `cost_per_unit` double unsigned NOT NULL DEFAULT '0',
  `profit_per_unit` double unsigned NOT NULL DEFAULT '0',
  `profit_per_unit_adjusted` double unsigned NOT NULL DEFAULT '0',
  `shrinkager_ratio` double unsigned NOT NULL DEFAULT '0',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`strategy_calculation_line_id`),
  KEY `strategy_calculation_id` (`strategy_calculation_id`),
  KEY `outlet_id` (`outlet_id`),
  KEY `active` (`active`)
) ENGINE=InnoDB AUTO_INCREMENT=38815051 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `strategy_template`
--

DROP TABLE IF EXISTS `strategy_template`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `strategy_template` (
  `strategy_template_id` int unsigned NOT NULL AUTO_INCREMENT,
  `sort_order` int unsigned NOT NULL DEFAULT '0',
  `publication_id` int unsigned NOT NULL,
  `owner_id` int unsigned NOT NULL,
  `name` varchar(64) NOT NULL DEFAULT '',
  `description` text NOT NULL,
  `template_type` smallint NOT NULL DEFAULT '0',
  `template_class` smallint NOT NULL DEFAULT '0',
  `increase_by_percentage_overall_pre` smallint NOT NULL DEFAULT '0',
  `service_degree` smallint NOT NULL DEFAULT '0',
  `increase_by_percentage_per_outlet` smallint NOT NULL DEFAULT '0',
  `increase_by_percentage_overall_post` smallint NOT NULL DEFAULT '0',
  `disregard_fixed_deliveries` tinyint NOT NULL DEFAULT '0',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `disregard_minimum_deliveries` tinyint(1) NOT NULL DEFAULT '0',
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `increase_draw_by_percentage` smallint NOT NULL DEFAULT '0',
  `maximum_return_percentage_outlet` tinyint NOT NULL DEFAULT '0',
  `maximum_return_percentage_overall` tinyint NOT NULL DEFAULT '0',
  `draw_template_type` tinyint unsigned NOT NULL DEFAULT '0',
  `fixed_total_draw` int NOT NULL DEFAULT '0',
  `disregard_maximum_deliveries` tinyint(1) NOT NULL DEFAULT '0',
  `disregard_maximum_ret_pct` tinyint(1) NOT NULL DEFAULT '0',
  `add_to_fixed_deliveries` tinyint(1) NOT NULL DEFAULT '0',
  `disregard_draw_floor` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`strategy_template_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB AUTO_INCREMENT=715 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `street`
--

DROP TABLE IF EXISTS `street`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `street` (
  `street_id` int unsigned NOT NULL AUTO_INCREMENT,
  `country_id` smallint unsigned NOT NULL,
  `city_id` int unsigned NOT NULL,
  `street_name` varchar(255) NOT NULL DEFAULT '',
  `longitude` char(9) NOT NULL DEFAULT '',
  `latitude` char(9) NOT NULL DEFAULT '',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT '0000-00-00 00:00:00',
  PRIMARY KEY (`street_id`),
  UNIQUE KEY `street_name` (`street_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sub_publication`
--

DROP TABLE IF EXISTS `sub_publication`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sub_publication` (
  `sub_publication_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `sub_publication_name` varchar(64) NOT NULL DEFAULT '',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`sub_publication_id`),
  KEY `publication_id` (`publication_id`),
  KEY `sub_publication_name` (`sub_publication_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tag_library`
--

DROP TABLE IF EXISTS `tag_library`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tag_library` (
  `tag_library_id` int unsigned NOT NULL AUTO_INCREMENT,
  `tag` varchar(32) NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`tag_library_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tarif`
--

DROP TABLE IF EXISTS `tarif`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tarif` (
  `tarif_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `country_id` smallint NOT NULL,
  `day_of_week` tinyint NOT NULL,
  `zip_range_from` int NOT NULL,
  `zip_range_to` int NOT NULL,
  `profit_per_unit` double NOT NULL,
  `cost_per_unit` double NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`tarif_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tarif_outlet`
--

DROP TABLE IF EXISTS `tarif_outlet`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tarif_outlet` (
  `tarif_outlet_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `outlet_id` int unsigned NOT NULL,
  `day_of_week` tinyint NOT NULL,
  `additional` tinyint(1) NOT NULL DEFAULT '1',
  `profit_per_outlet` double NOT NULL,
  `cost_per_outlet` double NOT NULL,
  `profit_per_unit` double NOT NULL,
  `cost_per_unit` double NOT NULL,
  `cost_per_unit_es` double NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`tarif_outlet_id`),
  UNIQUE KEY `tariff_unique` (`outlet_id`,`day_of_week`),
  KEY `publication_id` (`publication_id`,`outlet_id`)
) ENGINE=InnoDB AUTO_INCREMENT=3198391 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tarif_outlet_date`
--

DROP TABLE IF EXISTS `tarif_outlet_date`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tarif_outlet_date` (
  `tarif_outlet_date_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `tarif_outlet_date_header_id` int unsigned NOT NULL,
  `outlet_id` int unsigned NOT NULL,
  `tarif_date_start` date NOT NULL DEFAULT '2000-01-01',
  `tarif_date_end` date NOT NULL DEFAULT '2050-01-01',
  `day_of_week` tinyint NOT NULL DEFAULT '0',
  `additional` tinyint(1) NOT NULL DEFAULT '1',
  `profit_per_outlet` double NOT NULL,
  `cost_per_outlet` double NOT NULL,
  `profit_per_unit` double NOT NULL,
  `cost_per_unit` double NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`tarif_outlet_date_id`),
  KEY `publication_id` (`publication_id`),
  KEY `outlet_id` (`outlet_id`),
  KEY `tarif_date_start` (`tarif_date_start`)
) ENGINE=InnoDB AUTO_INCREMENT=2666719 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tarif_outlet_date_header`
--

DROP TABLE IF EXISTS `tarif_outlet_date_header`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tarif_outlet_date_header` (
  `tarif_outlet_date_header_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `tarif_date_start` date NOT NULL DEFAULT '2000-01-01',
  `tarif_date_end` date NOT NULL DEFAULT '2050-01-01',
  `day_of_week` tinyint NOT NULL DEFAULT '0',
  `name` varchar(255) NOT NULL DEFAULT '',
  `description` text NOT NULL,
  `method` tinyint NOT NULL DEFAULT '1',
  `copy_from_weekday` tinyint NOT NULL DEFAULT '0',
  `profit_per_unit` double NOT NULL,
  `cost_per_unit` double NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`tarif_outlet_date_header_id`),
  KEY `publication_id` (`publication_id`),
  KEY `tarif_date_start` (`tarif_date_start`)
) ENGINE=InnoDB AUTO_INCREMENT=85175 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `task`
--

DROP TABLE IF EXISTS `task`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `task` (
  `task_id` int unsigned NOT NULL AUTO_INCREMENT,
  `parent_task_id` int unsigned NOT NULL DEFAULT '0',
  `user_id` int unsigned NOT NULL DEFAULT '0',
  `publication_id` int unsigned NOT NULL DEFAULT '0',
  `strategy_template_id` int unsigned NOT NULL DEFAULT '0',
  `name` varchar(255) NOT NULL DEFAULT '',
  `units_total` int NOT NULL DEFAULT '0',
  `units_completed` int NOT NULL DEFAULT '0',
  `done` tinyint(1) NOT NULL DEFAULT '0',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`task_id`)
) ENGINE=InnoDB AUTO_INCREMENT=18804 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `theta`
--

DROP TABLE IF EXISTS `theta`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `theta` (
  `theta_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `outlet_group_id` int unsigned NOT NULL,
  `day_of_week` tinyint NOT NULL,
  `theta_1` decimal(12,6) NOT NULL DEFAULT '0.000000',
  `theta_2` decimal(12,6) NOT NULL DEFAULT '0.000000',
  `theta_3` decimal(12,6) NOT NULL DEFAULT '0.000000',
  `theta_4` decimal(12,6) NOT NULL DEFAULT '0.000000',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`theta_id`),
  KEY `publication_id` (`publication_id`),
  KEY `outlet_group_id` (`outlet_group_id`)
) ENGINE=InnoDB AUTO_INCREMENT=209144 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `turk_action`
--

DROP TABLE IF EXISTS `turk_action`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `turk_action` (
  `turk_action_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `day_of_week` tinyint NOT NULL DEFAULT '0',
  `hour_of_day` tinyint NOT NULL DEFAULT '0',
  `latest_day_of_week` tinyint NOT NULL DEFAULT '0',
  `latest_hour_of_day` tinyint NOT NULL DEFAULT '0',
  `name` varchar(64) NOT NULL DEFAULT '',
  `description` text NOT NULL,
  `type` tinyint NOT NULL DEFAULT '0',
  `chain_turk_action_id` int unsigned NOT NULL DEFAULT '0',
  `child_action` tinyint(1) NOT NULL DEFAULT '0',
  `run_child_if` tinyint NOT NULL DEFAULT '1',
  `last_run` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `times_run` int unsigned NOT NULL DEFAULT '0',
  `turk_action_historic_id` int unsigned NOT NULL DEFAULT '0',
  `warning_count` int unsigned NOT NULL DEFAULT '0',
  `error` tinyint(1) NOT NULL DEFAULT '0',
  `import_template_id` int NOT NULL DEFAULT '0',
  `verification_only` tinyint(1) NOT NULL DEFAULT '0',
  `file_template` varchar(64) NOT NULL DEFAULT '',
  `post_process` tinyint(1) NOT NULL DEFAULT '1',
  `post_process_move_file` tinyint(1) NOT NULL DEFAULT '1',
  `strategy_calculation_id` int NOT NULL DEFAULT '0',
  `start_week` tinyint NOT NULL DEFAULT '1',
  `num_weeks` tinyint NOT NULL DEFAULT '1',
  `monday` tinyint(1) NOT NULL DEFAULT '1',
  `tuesday` tinyint(1) NOT NULL DEFAULT '1',
  `wednesday` tinyint(1) NOT NULL DEFAULT '1',
  `thursday` tinyint(1) NOT NULL DEFAULT '1',
  `friday` tinyint(1) NOT NULL DEFAULT '1',
  `saturday` tinyint(1) NOT NULL DEFAULT '1',
  `sunday` tinyint(1) NOT NULL DEFAULT '1',
  `draw_export_configuration_id` int unsigned NOT NULL DEFAULT '0',
  `move_to_production` tinyint(1) NOT NULL DEFAULT '0',
  `pack_draw_files` tinyint(1) NOT NULL DEFAULT '0',
  `pack_draw_filename` varchar(64) NOT NULL DEFAULT '',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `strategy_template_id` int NOT NULL DEFAULT '0',
  `turk_active` tinyint(1) NOT NULL DEFAULT '1',
  `monday_template` int NOT NULL DEFAULT '0',
  `tuesday_template` int NOT NULL DEFAULT '0',
  `wednesday_template` int NOT NULL DEFAULT '0',
  `thursday_template` int NOT NULL DEFAULT '0',
  `friday_template` int NOT NULL DEFAULT '0',
  `saturday_template` int NOT NULL DEFAULT '0',
  `sunday_template` int NOT NULL DEFAULT '0',
  `automate` tinyint(1) NOT NULL DEFAULT '0',
  `turk_chain_id` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`turk_action_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB AUTO_INCREMENT=332 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `turk_action_active`
--

DROP TABLE IF EXISTS `turk_action_active`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `turk_action_active` (
  `turk_action_active_id` int unsigned NOT NULL AUTO_INCREMENT,
  `turk_action_id` int unsigned NOT NULL,
  `turk_chain_id` int unsigned NOT NULL DEFAULT '0',
  `turk_execution_id` int unsigned NOT NULL,
  `zombie` tinyint(1) NOT NULL DEFAULT '0',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`turk_action_active_id`),
  KEY `turk_action_id` (`turk_action_id`)
) ENGINE=InnoDB AUTO_INCREMENT=2184299 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `turk_action_historic`
--

DROP TABLE IF EXISTS `turk_action_historic`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `turk_action_historic` (
  `turk_action_historic_id` int unsigned NOT NULL AUTO_INCREMENT,
  `turk_execution_id` int unsigned NOT NULL,
  `turk_action_id` int unsigned NOT NULL,
  `publication_id` int unsigned NOT NULL,
  `started` datetime NOT NULL,
  `ended` datetime NOT NULL,
  `file` varchar(64) NOT NULL DEFAULT '',
  `status` tinyint NOT NULL DEFAULT '0',
  `termination_issue` int unsigned NOT NULL DEFAULT '0',
  `exec_type` tinyint NOT NULL DEFAULT '0',
  `import_log_id` int unsigned NOT NULL DEFAULT '0',
  `import_console_mark` varchar(64) NOT NULL DEFAULT '',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `draw_dates` varchar(128) NOT NULL DEFAULT '',
  `draw_template_id` int unsigned NOT NULL DEFAULT '0',
  `draw_class_id` int unsigned NOT NULL DEFAULT '0',
  `draw_filename` varchar(64) NOT NULL DEFAULT '',
  `pack_draw_files` tinyint(1) NOT NULL DEFAULT '0',
  `pack_draw_filename` varchar(64) NOT NULL DEFAULT '',
  `mechanical_turk_execution_id` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`turk_action_historic_id`),
  KEY `turk_action_id` (`turk_action_id`)
) ENGINE=InnoDB AUTO_INCREMENT=104443 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `turk_action_issue`
--

DROP TABLE IF EXISTS `turk_action_issue`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `turk_action_issue` (
  `turk_action_issue_id` int unsigned NOT NULL AUTO_INCREMENT,
  `turk_action_id` int unsigned NOT NULL,
  `publication_id` int unsigned NOT NULL,
  `issue_class` int unsigned NOT NULL,
  `issue_type` int unsigned NOT NULL,
  `boundary` int NOT NULL DEFAULT '0',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`turk_action_issue_id`),
  KEY `turk_action_id` (`turk_action_id`)
) ENGINE=InnoDB AUTO_INCREMENT=194 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `turk_action_issue_raised`
--

DROP TABLE IF EXISTS `turk_action_issue_raised`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `turk_action_issue_raised` (
  `turk_action_issue_raised_id` int unsigned NOT NULL AUTO_INCREMENT,
  `turk_execution_id` int unsigned NOT NULL,
  `turk_action_id` int unsigned NOT NULL,
  `publication_id` int unsigned NOT NULL,
  `turk_action_historic_id` int unsigned NOT NULL,
  `issue_class` int unsigned NOT NULL,
  `issue_type` int unsigned NOT NULL,
  `boundary` int NOT NULL DEFAULT '0',
  `issue_value` int NOT NULL DEFAULT '0',
  `comparison_type` tinyint NOT NULL DEFAULT '0',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`turk_action_issue_raised_id`),
  KEY `turk_action_id` (`turk_action_id`)
) ENGINE=InnoDB AUTO_INCREMENT=482 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `turk_execution`
--

DROP TABLE IF EXISTS `turk_execution`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `turk_execution` (
  `turk_execution_id` int unsigned NOT NULL AUTO_INCREMENT,
  `execution_start` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `execution_end` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `pack_temporary_draw_files` tinyint(1) NOT NULL DEFAULT '0',
  `execution_status` tinyint NOT NULL DEFAULT '0',
  PRIMARY KEY (`turk_execution_id`)
) ENGINE=InnoDB AUTO_INCREMENT=230038 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `turk_log`
--

DROP TABLE IF EXISTS `turk_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `turk_log` (
  `turk_log_id` int unsigned NOT NULL AUTO_INCREMENT,
  `turk_execution_id` int unsigned NOT NULL,
  `mechanical_turk_excution_id` int unsigned NOT NULL DEFAULT '0',
  `turk_action_id` int unsigned NOT NULL DEFAULT '0',
  `turk_action_historic_id` int unsigned NOT NULL DEFAULT '0',
  `publication_id` int unsigned NOT NULL,
  `message` text NOT NULL,
  `additional_info` varchar(255) NOT NULL DEFAULT '',
  `type` tinyint NOT NULL DEFAULT '1',
  `level` tinyint NOT NULL DEFAULT '5',
  `log_date` datetime NOT NULL,
  `error_number` int unsigned NOT NULL DEFAULT '0',
  `log_index` int unsigned NOT NULL DEFAULT '0',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`turk_log_id`),
  KEY `turk_action_id` (`turk_action_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB AUTO_INCREMENT=412900 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `unified_draw`
--

DROP TABLE IF EXISTS `unified_draw`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `unified_draw` (
  `unified_draw_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `strategy_template_id` int unsigned NOT NULL,
  `unify_type` tinyint unsigned NOT NULL DEFAULT '0',
  `mixed_threshhold` varchar(63) NOT NULL DEFAULT '3,6,9,12,15,18',
  `outlet_class_id` int unsigned NOT NULL DEFAULT '0',
  `unify_weekdays` tinyint unsigned NOT NULL DEFAULT '0',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`unified_draw_id`),
  KEY `publication_id` (`publication_id`),
  KEY `strategy_template_id` (`strategy_template_id`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `upload`
--

DROP TABLE IF EXISTS `upload`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `upload` (
  `upload_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL DEFAULT '0',
  `id` varchar(64) NOT NULL DEFAULT '',
  `type` tinyint NOT NULL DEFAULT '1',
  `version` mediumint NOT NULL DEFAULT '1',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`upload_id`),
  KEY `id` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `upload_template`
--

DROP TABLE IF EXISTS `upload_template`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `upload_template` (
  `upload_template_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `name` varchar(64) NOT NULL DEFAULT '',
  `description` text NOT NULL,
  `type` tinyint NOT NULL DEFAULT '0',
  `skip_first_rows` tinyint NOT NULL DEFAULT '0',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`upload_template_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `upload_template_element`
--

DROP TABLE IF EXISTS `upload_template_element`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `upload_template_element` (
  `upload_template_element_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `name` varchar(64) NOT NULL DEFAULT '',
  `description` text NOT NULL,
  `col` tinyint NOT NULL DEFAULT '0',
  `table_name` varchar(64) NOT NULL DEFAULT '',
  `column_name` varchar(64) NOT NULL DEFAULT '',
  `field_type` tinyint NOT NULL DEFAULT '0',
  `date_format` tinyint NOT NULL DEFAULT '0',
  `optional` tinyint(1) NOT NULL DEFAULT '0',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`upload_template_element_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `upload_template_validation`
--

DROP TABLE IF EXISTS `upload_template_validation`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `upload_template_validation` (
  `upload_template_validation_id` int unsigned NOT NULL AUTO_INCREMENT,
  `publication_id` int unsigned NOT NULL,
  `name` varchar(64) NOT NULL DEFAULT '',
  `description` text NOT NULL,
  `type` tinyint NOT NULL DEFAULT '0',
  `rule` varchar(64) NOT NULL DEFAULT '',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`upload_template_validation_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `us_state`
--

DROP TABLE IF EXISTS `us_state`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `us_state` (
  `us_state_id` tinyint unsigned NOT NULL AUTO_INCREMENT,
  `state_name` varchar(64) NOT NULL DEFAULT '',
  `state_usps` char(2) NOT NULL DEFAULT '',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT '0000-00-00 00:00:00',
  PRIMARY KEY (`us_state_id`),
  UNIQUE KEY `state_name` (`state_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user`
--

DROP TABLE IF EXISTS `user`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user` (
  `user_id` smallint unsigned NOT NULL AUTO_INCREMENT,
  `login` varchar(64) NOT NULL DEFAULT '',
  `password` varchar(64) NOT NULL DEFAULT '',
  `name` varchar(255) NOT NULL DEFAULT '',
  `description` text NOT NULL,
  `role` tinyint unsigned NOT NULL DEFAULT '1',
  `email` varchar(255) NOT NULL DEFAULT '',
  `logout_timer` mediumint unsigned NOT NULL DEFAULT '0',
  `last_login` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_activity` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `publication_id` smallint unsigned NOT NULL DEFAULT '0',
  `language_id` tinyint unsigned NOT NULL DEFAULT '1',
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by_user` smallint unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`user_id`),
  KEY `login` (`login`)
) ENGINE=InnoDB AUTO_INCREMENT=46 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user_knows_publication`
--

DROP TABLE IF EXISTS `user_knows_publication`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_knows_publication` (
  `user_knows_publication_id` int unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int unsigned NOT NULL,
  `publication_id` int unsigned NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_knows_publication_id`),
  KEY `user_id` (`user_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB AUTO_INCREMENT=732 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user_permission`
--

DROP TABLE IF EXISTS `user_permission`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_permission` (
  `user_permission_id` int unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int unsigned NOT NULL,
  `publication_id` int unsigned NOT NULL,
  `permission_id` smallint NOT NULL,
  `permission_value` tinyint(1) NOT NULL DEFAULT '1',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_permission_id`),
  KEY `user_id` (`user_id`),
  KEY `publication_id` (`publication_id`)
) ENGINE=InnoDB AUTO_INCREMENT=57590 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user_posse`
--

DROP TABLE IF EXISTS `user_posse`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_posse` (
  `user_posse_id` int unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int unsigned NOT NULL,
  `posse_user_id` int unsigned NOT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_posse_id`),
  KEY `user_id` (`user_id`)
) ENGINE=InnoDB AUTO_INCREMENT=88 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `zip`
--

DROP TABLE IF EXISTS `zip`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `zip` (
  `zip_id` int unsigned NOT NULL AUTO_INCREMENT,
  `country_id` smallint unsigned NOT NULL,
  `zip_code` varchar(16) NOT NULL DEFAULT '',
  `zip_name` varchar(32) NOT NULL DEFAULT '',
  `active` tinyint NOT NULL DEFAULT '1',
  `date_upd` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `date_created` timestamp NOT NULL DEFAULT '0000-00-00 00:00:00',
  `longitude` char(9) NOT NULL DEFAULT '',
  `latitude` char(9) NOT NULL DEFAULT '',
  `municipality_name` varchar(64) NOT NULL DEFAULT '',
  `municipality_id` int NOT NULL DEFAULT '0',
  `city_name` varchar(64) NOT NULL DEFAULT '',
  `city_id` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`zip_id`),
  UNIQUE KEY `zip_code` (`zip_code`),
  KEY `zip_name` (`zip_name`)
) ENGINE=InnoDB AUTO_INCREMENT=1108 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-03-03 11:09:29
